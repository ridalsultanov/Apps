const fs=require('fs'),path=require('path');const dir=path.join(__dirname,'source');
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const hero='data:image/png;base64,'+fs.readFileSync(path.join(dir,'mira-hero.png')).toString('base64');
html=html.replace(/<link rel="manifest"[^>]*>/,'').replace('href="icon.svg"','href="data:image/svg+xml;base64,'+fs.readFileSync(path.join(dir,'icon.svg')).toString('base64')+'"').replace('href="icon-192.png"','href="data:image/png;base64,'+fs.readFileSync(path.join(dir,'icon-192.png')).toString('base64')+'"');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(dir,'style.css'),'utf8')+'\n'+fs.readFileSync(path.join(dir,'polish.css'),'utf8').replaceAll("url('mira-hero.png')","var(--mira-art)")+'</style>');
let game=fs.readFileSync(path.join(dir,'game.js'),'utf8').replace("const MIRA_ART_SOURCE='mira-hero.png';",()=>"const MIRA_ART_SOURCE='"+hero+"'; document.documentElement.style.setProperty('--mira-art', 'url(\"'+MIRA_ART_SOURCE+'\")');").replace(/if\('serviceWorker'in navigator[^\n]+/,'');
html=html.replace('<script src="game.js"></script><script src="adventure.js"></script>',()=>'<script>'+game+'</script><script>'+fs.readFileSync(path.join(dir,'adventure.js'),'utf8')+'</script><script>'+fs.readFileSync(path.join(dir,'polish.js'),'utf8')+'</script>');
fs.mkdirSync(__dirname,{recursive:true});fs.writeFileSync(path.join(__dirname,'index.html'),html);console.log('Built '+Buffer.byteLength(html)+' bytes');
