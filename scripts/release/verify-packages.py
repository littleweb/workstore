"""Verify every app file/link and permission in macOS distribution packages."""
from pathlib import Path
import hashlib,json,os,plistlib,subprocess,sys,tempfile
app=Path(sys.argv[1]);dmg=Path(sys.argv[2]);updater=Path(sys.argv[3]) if len(sys.argv)>3 else None

def files(root):
 result={}
 for parent,dirs,names in os.walk(root,followlinks=False):
  for name in dirs+names:
   path=Path(parent)/name;mode=path.lstat().st_mode&0o777;key=str(path.relative_to(root))
   if path.is_symlink():result[key]={'link':os.readlink(path),'mode':mode}
   elif path.is_file():
    digest=hashlib.sha256()
    with path.open('rb') as source:
     for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    result[key]={'sha256':digest.hexdigest(),'size':path.stat().st_size,'mode':mode}
 return result
expected=files(app)
if not expected:raise RuntimeError('Built app is missing')
if updater:
 with tempfile.TemporaryDirectory(prefix='workstore-update-verification-') as temp:
  subprocess.run(['tar','-xzf',str(updater),'-C',temp],check=True)
  if files(Path(temp)/app.name)!=expected:raise RuntimeError('Updater application files or permissions differ')
info=plistlib.loads(subprocess.check_output(['hdiutil','attach','-readonly','-nobrowse','-plist',str(dmg)]))
mount=next(Path(entity['mount-point']) for entity in info['system-entities'] if 'mount-point' in entity)
try:
 if files(mount/app.name)!=expected:raise RuntimeError('DMG application files or permissions differ')
finally:subprocess.run(['hdiutil','detach',str(mount)],check=True,stdout=subprocess.DEVNULL)
print(json.dumps({'appBytes':sum(f.get('size',0) for f in expected.values()),'dmgBytes':dmg.stat().st_size,'files':len(expected),'updaterMatches':bool(updater),'dmgMatches':True}))
