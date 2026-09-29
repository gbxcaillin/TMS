import sys,zipfile,re
from xml.dom import minidom
for f in sys.argv[1:]:
    z=zipfile.ZipFile(f)
    for n in z.namelist():
        if n.endswith('.xml') or n.endswith('.rels'): minidom.parseString(z.read(n))
    x=z.read('word/document.xml').decode()
    paras=re.findall(r'<w:p>.*?</w:p>',x,re.S)
    heads=[''.join(re.findall(r'<w:t[^>]*>([^<]*)</w:t>',p)) for p in paras if 'Heading1' in p]
    conf=len(re.findall(r'\[\[CONFIRM',x))
    print(f"{f}: OK, {len(z.namelist())} parts, {len(paras)} paragraphs, {x.count('<w:tbl>')} tables, {conf} CONFIRM marks")
    print('  sections:',' | '.join(heads))
