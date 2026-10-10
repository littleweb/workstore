from pathlib import Path
import tarfile,hashlib,json,os,gzip,sys,platform,posixpath
if sys.platform!='darwin' or platform.machine()!='arm64':raise SystemExit('Only verified macOS ARM64 components can be published by this packer')
out=Path('.release-build/resources');out.mkdir(parents=True,exist_ok=True)
components={
 'node':('src-tauri/html-runtime',['node','NODE-LICENSE']),
 'animation':('src-tauri/course-runtime',['app.tar.gz','manifest.json']),
 'whiteboard':('src-tauri/whiteboard-runtime',['app.tar.gz','manifest.json']),
 'html-service':('src-tauri/html-runtime',['app.tar','manifest.json','preload.cjs','HTML-ANYTHING-LICENSE'])}
def verify_inner(path):
 with tarfile.open(path) as archive:
  for item in archive:
   name=posixpath.normpath(item.name)
   if name.startswith('/') or name=='..' or name.startswith('../'):raise RuntimeError('Unsafe component path')
   if item.issym() or item.islnk():
    target=item.linkname
    resolved=posixpath.normpath(posixpath.join(posixpath.dirname(name),target)) if item.issym() else posixpath.normpath(target)
    if target.startswith('/') or resolved=='..' or resolved.startswith('../'):raise RuntimeError('Component link cannot be relocated: '+item.name)
if len(sys.argv)==3 and sys.argv[1]=='--verify-archive':
 verify_inner(Path(sys.argv[2]));print('Portable archive verified');raise SystemExit()
records=[]
for kind,(source,names) in components.items():
 target=out/(kind+'.tar.gz')
 if kind!='node':verify_inner(Path(source)/('app.tar' if kind=='html-service' else 'app.tar.gz'))
 with target.open('wb') as output, gzip.GzipFile(filename='',mode='wb',fileobj=output,compresslevel=1,mtime=0) as compressed, tarfile.open(fileobj=compressed,mode='w') as archive:
  for name in names:
   path=Path(source)/name
   assert path.is_file() and not path.is_symlink()
   info=archive.gettarinfo(str(path),arcname=name);info.uid=info.gid=info.mtime=0;info.uname=info.gname=''
   with path.open('rb') as stream:archive.addfile(info,stream)
 size=target.stat().st_size;assert size<512*1024*1024
 digest=hashlib.sha256(target.read_bytes()).hexdigest();filename=digest+'.tar.gz';final=out/filename
 if final.exists():target.unlink()
 else:target.rename(final)
 checks={name:{'size':(Path(source)/name).stat().st_size,'sha256':hashlib.sha256((Path(source)/name).read_bytes()).hexdigest(),'mode':(Path(source)/name).stat().st_mode & 0o777} for name in names}
 records.append({'checks':checks,'key':f'component:{kind}:darwin-aarch64','source':str(final),'filename':filename,'sha256':digest,'size':size,'kind':'component'})
 print(kind,round(size/1048576,2),'MiB')
(out/'components.json').write_text(json.dumps(records,indent=2)+'\n')
