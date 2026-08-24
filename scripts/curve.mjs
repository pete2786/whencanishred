import { readFileSync } from "node:fs";
const wetBulbC=(T,RH)=>T*Math.atan(0.151977*Math.sqrt(RH+8.313659))+Math.atan(T+RH)-Math.atan(RH-1.676331)+0.00391838*Math.pow(RH,1.5)*Math.atan(0.023101*RH)-4.686035;
const h=JSON.parse(readFileSync("data/cache/Hyland-Hills.json","utf8"));
const sum=new Map();
for(let i=0;i<h.time.length;i++){
  const s=h.time[i], md=s.slice(5,10);
  const T=h.temperature_2m[i], RH=h.relative_humidity_2m[i];
  if(T==null||RH==null) continue;
  const wb=wetBulbC(T,RH)*9/5+32;
  if(!sum.has(md)) sum.set(md,[0,0]);
  const e=sum.get(md); e[0]+=wb; e[1]++;
}
const mean=md=>{const e=sum.get(md); return e? e[0]/e[1] : null;};
const marks=["08-23","09-01","09-15","10-01","10-15","11-01","11-15","12-01","12-15","12-31"];
console.log("Twin Cities mean wet-bulb (F), 1995-2025:");
for(const m of marks) console.log("  "+m+"  "+mean(m).toFixed(1));
// day the mean curve crosses 28F
let prev=null;
for(const [md,[s,n]] of [...sum.entries()].sort()){
  const v=s/n;
  if(md<"08-23"&&md>"01-15") continue;
  if(prev&&prev.v>=28&&v<28&&md>"09-01") { console.log("\nmean curve crosses 28F at "+md); break; }
  prev={md,v};
}
