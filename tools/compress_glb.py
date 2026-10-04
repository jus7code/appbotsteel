"""Reduce el peso de un GLB redimensionando sus texturas.

Uso: .venv-tools/bin/python tools/compress_glb.py entrada.glb salida.glb [tam_max]

Las texturas sin transparencia se guardan como JPEG; las que tienen alfa siguen en PNG.
La geometría y el esqueleto no se tocan.
"""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    _, _, _ = struct.unpack_from('<4sII', data, 0)
    off = 12
    gltf, binchunk = None, b''
    while off < len(data):
        length, ctype = struct.unpack_from('<II', data, off)
        chunk = data[off + 8: off + 8 + length]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif ctype == 0x004E4942:
            binchunk = chunk
        off += 8 + length
    return gltf, binchunk


def shrink(raw, max_size):
    img = Image.open(io.BytesIO(raw))
    img.load()
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), Image.LANCZOS)
    has_alpha = img.mode in ('RGBA', 'LA', 'P') and img.convert('RGBA').getextrema()[3][0] < 255
    out = io.BytesIO()
    if has_alpha:
        img.convert('RGBA').save(out, 'PNG', optimize=True)
        return out.getvalue(), 'image/png'
    img.convert('RGB').save(out, 'JPEG', quality=85)
    return out.getvalue(), 'image/jpeg'


def main():
    src, dst = sys.argv[1], sys.argv[2]
    max_size = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    gltf, binchunk = read_glb(src)
    views = gltf['bufferViews']

    replaced = {}
    for im in gltf.get('images', []):
        bv = im['bufferView']
        v = views[bv]
        raw = binchunk[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
        replaced[bv], im['mimeType'] = shrink(raw, max_size)

    # Reempaqueta todos los bufferViews en un buffer nuevo, alineado a 4 bytes.
    out = bytearray()
    for i, v in enumerate(views):
        start = v.get('byteOffset', 0)
        chunk = replaced.get(i, binchunk[start: start + v['byteLength']])
        out += b'\0' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(chunk)
        out += chunk
    out += b'\0' * (-len(out) % 4)
    gltf['buffers'] = [{'byteLength': len(out)}]

    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(out), 0x004E4942) + out)
    print(f'{dst}: {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
