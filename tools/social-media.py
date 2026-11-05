"""Public single-post extractor. Run in a private, size-monitored job directory."""
import ipaddress
import json
import os
import socket
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

import requests
import yt_dlp
from gallery_dl import config, extractor
from gallery_dl.extractor.message import Message

# Check the very addresses returned to the connecting socket, including redirects.
proxy = urlsplit(os.environ.get("HTTPS_PROXY", ""))
resolve = socket.getaddrinfo
def public_addresses(*args, **kwargs):
    rows = resolve(*args, **kwargs)
    # A trusted egress proxy resolves and filters destinations on behalf of the worker.
    if proxy.hostname and args[0] == proxy.hostname and str(args[1]) == str(proxy.port or (443 if proxy.scheme == 'https' else 80)):
        return rows
    for row in rows:
        ip = ipaddress.ip_address(row[4][0])
        if not ip.is_global or ip.is_multicast or (ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global):
            raise OSError("Non-public network address")
    return rows
socket.getaddrinfo = public_addresses

session = requests.Session()
session.trust_env = bool(proxy.hostname)
LIMIT = 32 * 1024 * 1024
MAX_ITEMS = 10
def get(url, **kwargs):
    if urlsplit(url).scheme != 'https':
        raise ValueError("HTTPS required")
    r = session.get(url, timeout=(8, 12), stream=True, **kwargs)
    r.raise_for_status()
    return r

def read_small(r, limit):
    out = bytearray()
    for chunk in r.iter_content(65536):
        out.extend(chunk)
        if len(out) > limit:
            raise ValueError("response size limit")
    return bytes(out)

def save_media(url, index, referer):
    with get(url, headers={'Referer': referer}) as r:
        data = read_small(r, LIMIT)
    if data[:3] == b'\xff\xd8\xff': ext = 'jpg'
    elif data.startswith(b'\x89PNG\r\n\x1a\n'): ext = 'png'
    elif data[:4] == b'RIFF' and data[8:12] == b'WEBP': ext = 'webp'
    elif data[4:8] == b'ftyp' and data[8:12] not in (b'avif', b'avis', b'heic', b'mif1'): ext = 'mp4'
    else: raise ValueError("Unsupported media bytes")
    Path(f'media-{index:02}.{ext}').write_bytes(data)

def gallery(url):
    ext = extractor.find(url)
    if not ext or ext.subcategory not in {'post', 'tweet', 'photo'}:
        raise ValueError("Unsupported single post")
    count = 0
    for kind, link, _ in ext:
        if kind == Message.Url:
            count += 1
            if count > MAX_ITEMS: raise ValueError('Maximum 10 items')
            save_media(link, count, url)
    if not count: raise ValueError("No gallery media")

class FacebookMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = {}
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and a.get('property'):
            self.fields[a['property']] = a.get('content') or ''

def facebook_share(url, photo):
    # Link-crawler view and og:image handling follow Vette1123/social-media-downloader.
    with get(url, headers={'User-Agent': 'facebookexternalhit/1.1'}) as r:
        canonical = r.url
        html = read_small(r, 6 * 1024 * 1024)
    u = urlsplit(canonical)
    if u.hostname not in {'www.facebook.com','m.facebook.com','facebook.com'} or '/login' in u.path:
        raise ValueError('Facebook requires login')
    if photo:
        meta = FacebookMetadata()
        meta.feed(html.decode('utf8', 'replace'))
        link = meta.fields.get('og:image','')
        host = urlsplit(link).hostname or ''
        if not (host.endswith('.fbcdn.net') or host.endswith('.fbsbx.com')) or '/t15.' in link or meta.fields.get('og:video'):
            raise ValueError('Post photo unavailable')
        save_media(link, 1, canonical)
    return canonical

def video(url, audio):
    options = dict(noplaylist=True, socket_timeout=10, retries=1, fragment_retries=0,
                   max_filesize=LIMIT, outtmpl='media-01.%(ext)s', quiet=True,
                   format='bestaudio/best' if audio else 'best[ext=mp4][vcodec!=none][acodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]',
                   merge_output_format='mp4', allowed_extractors=['youtube','facebook','instagram','tiktok','tiktok:vm'],
                   match_filter=yt_dlp.utils.match_filter_func('!is_live & duration<=?600'))
    if audio:
        options['postprocessors'] = [dict(key='FFmpegExtractAudio', preferredcodec='mp3', preferredquality='128')]
    with yt_dlp.YoutubeDL(options) as engine:
        if engine.download([url]): raise ValueError("Extraction failed")

def run(url, mode):
    host, path = urlsplit(url).hostname, urlsplit(url).path
    config.set((), 'timeout', 10)
    config.set((), 'retries', 1)
    if host in {'twitter.com','www.twitter.com','x.com','www.x.com'}:
        # Public attachment list used by upstream tryVxTwitterMethod. Never use a thumbnail.
        try:
            with get('https://api.vxtwitter.com' + path.rstrip('/')) as r:
                items = json.loads(read_small(r, 1024*1024)).get('media_extended') or []
            if not 0 < len(items) <= MAX_ITEMS: raise ValueError("No attachments")
            for i, item in enumerate(items, 1): save_media(item['url'], i, url)
        except (requests.RequestException, ValueError, KeyError):
            for p in Path.cwd().glob('media-*'): p.unlink()
            gallery(url)
    elif 'instagram.com' in host and path.startswith('/p/'): gallery(url)
    elif 'facebook.com' in host and path.startswith('/share/'):
        photo = path.startswith('/share/p/')
        canonical = facebook_share(url, photo)
        if not photo: video(canonical, False)
    else: video(url, mode == 'mp3')

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
