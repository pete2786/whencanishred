import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const wb=(T,RH)=>T*Math.atan(0.151977*Math.sqrt(RH+8.313659))+Math.atan(T+RH)-Math.atan(RH-1.676331)+0.00391838*Math.pow(RH,1.5)*Math.atan(0.023101*RH)-4.686035;
const THR=(28-32)*5/9, CACHE="data/cache";
mkdirSync(CACHE,{recursive:true});
const HILLS=[["Wild Mountain",45.3897,-92.7143],["Trollhaugen",45.3572,-92.6349],["Hyland Hills",44.8297,-93.3672],["Afton Alps",44.8574,-92.7899],["Welch Village",44.5619,-92.7360],["Buck Hill",44.7433,-93.2872],["Elm Creek",45.1461,-93.4419],["Lutsen",47.6683,-90.7175],["Giants Ridge",47.5583,-92.2830],["Spirit Mountain",46.7183,-92.2200],["Powder Ridge",45.3308,-94.3086],["Mount Kato",44.1372,-94.0186],["Buena Vista",47.5875,-94.8464],["Detroit Mountain",46.8222,-95.7736],["Andes Tower Hills",45.8047,-95.6664],["Coffee Mill",44.3819,-92.0413]];
async function get(n,lat,lon){
  const f=`${CACHE}/${n.replace(/\s+/g,"-")}.json`;
  if(existsSync(f)) return JSON.parse(readFileSync(f,"utf8"));
  const u=`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=1995-09-01&end_date=2025-12-31&hourly=temperature_2m,relative_humidity_2m&timezone=America%2FChicago`;
  for(let a=0;a<6;a++){
    const r=await fetch(u);
    if(r.ok){const d=(await r.json()).hourly; writeFileSync(f,JSON.stringify(d)); return d;}
    if(r.status!==429) throw new Error(`${n}: ${r.status}`);
    await new Promise(x=>setTimeout(x,20000*(a+1)));
  }
  throw new Error(n+": rate-limited");
}
const out=[];
for(const [n,lat,lon] of HILLS){
  const h=await get(n,lat,lon), acc=new Map();
  for(let i=0;i<h.time.length;i++){
    const m=+h.time[i].slice(5,7);
    if(m!==10&&m!==11) continue;
    const T=h.temperature_2m[i],R=h.relative_humidity_2m[i];
    if(T==null||R==null) continue;
    if(wb(T,R)<THR){const y=+h.time[i].slice(0,4); acc.set(y,(acc.get(y)??0)+1);}
  }
  const v=[...acc.values()].sort((a,b)=>a-b);
  out.push({hill:n, normal:Math.round(v.reduce((a,b)=>a+b,0)/v.length), lean:v[0], fat:v[v.length-1]});
  process.stderr.write(".");
}
process.stderr.write("\n");
console.log(JSON.stringify(out));
