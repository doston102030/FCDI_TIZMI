import { useState, useEffect, useRef } from "react";
import Tesseract from "tesseract.js";
import { parse as parseMrzLib } from "mrz";
import { db, addRecord, listenRecords } from "./firebase";

// ─── Ma'lumotlar ──────────────────────────────────────────────────────────────
const MFY_LIST = [
  "O'zbekiston MFY","Namozgoh MFY","Mustaqillik MFY","Taraqqiyot MFY","Teraktashi MFY","Poloson MFY",
  "Ahmadbek (Barkamolavlod)","Kalacha MFY","Do'lan MFY","Yangimahalla Y.Sh","Tumor MFY","Sohibobod MFY",
  "Buvoydo","Kumqayroq MFY","Abdubiy MFY","Sherkurg'on MFY","Yangi hayot","Birlashgan MFY","Kozikurg'on MFY",
  "Suzoq MFY","Beshmahalla MFY","Navro'z MFY","Yangi obod MFY","Nayman MFY (Turkiston)","Kurg'oncha MFY (Uzb)",
  "Bayroq MFY","Maslahatepa MFY","Bobochek MFY","Kumtepa MFY","Nazarmahram","Holdambek",
  "Kum MFY","Segaza MFY","Ortish MFY","Hujaobod MFY","Yonboshdurman MFY","Durman MFY","Oktunlik MFY",
  "Shaydo MFY","Tegirmonboshi MFY","Begbachcha MFY","Ipak yo'li MFY","Tulqin MFY","Yanginaynavo MFY",
  "Qorabo'yin MFY","Kumarik MFY","Kushkunok MFY","Yani zamon MFY","Markaz MFY","Yuzlar MFY",
  "Kipchakurg'on MFY","Nayman MFY (Y.Yo'l)","Shahrixon MFY","Kuruksoy MFY","Buston MFY (Chuja)",
  "Eshon MFY","Chuja MFY","Do'stlik MFY","Karnaychi MFY","Andajon MFY","Beshariq MFY","Yakkatut MFY",
  "Soroy MFY","Navbahor MFY","Kayrag'ochguzar MFY","Qorakurpa MFY","Mullahoy MFY","Kashqar MFY",
  "Bahor MFY","Andijonlik MFY","Yoshlar MFY","Yangi turmush MFY (Ur.)","Shokirboy MFY","Servis",
  "Hududgaz Andijon GTF Shahrixon tuman","Bo'lim boshlig'i"
].map((name, i) => ({ id: i + 1, name }));

const USERS = {
  admin:  { password: "admin123", role: "boshliq", name: "Bo'lim boshlig'i" },
  hodim1: { password: "1234",     role: "hodim",   name: "Hodim Alisher" },
  hodim2: { password: "1234",     role: "hodim",   name: "Hodim Sardor" },
  hodim3: { password: "1234",     role: "hodim",   name: "Hodim Jasur" },
};

const fmt     = d => new Date(d).toLocaleTimeString("uz-UZ", { hour:"2-digit", minute:"2-digit" });
const fmtDate = d => new Date(d).toLocaleDateString("uz-UZ", { day:"2-digit", month:"2-digit", year:"numeric" });
const todayStr = () => fmtDate(new Date());

// ─── Ovoz ────────────────────────────────────────────────────────────────────
const playBeep = () => {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [[523,0,0.12],[659,0.13,0.12],[784,0.26,0.22]].forEach(([f,t,d]) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.4, ac.currentTime+t);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime+t+d);
      o.start(ac.currentTime+t); o.stop(ac.currentTime+t+d+0.05);
    });
  } catch {}
};

// ─── Rasm ishlash ─────────────────────────────────────────────────────────────
// Sharpen filter (3×3 konvolyutsiya) — xira rasmlar uchun
const applySharpen = (ctx, w, h) => {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = new ImageData(w, h);
  const s = src.data, d = dst.data;
  const K = [0,-1,0,-1,5,-1,0,-1,0];
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let ky=-1; ky<=1; ky++)
          for (let kx=-1; kx<=1; kx++)
            v += s[((y+ky)*w+(x+kx))*4+c] * K[(ky+1)*3+(kx+1)];
        d[(y*w+x)*4+c] = Math.min(255, Math.max(0, v));
      }
      d[(y*w+x)*4+3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
};

// Aniqlik o'lchash (Laplacian variance) — xira kadrlarni o'tkazib yuborish
const sharpness = canvas => {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(Math.floor(w*0.25), Math.floor(h*0.25),
                              Math.floor(w*0.5),  Math.floor(h*0.5)).data;
  let s = 0;
  const W = Math.floor(w*0.5), H = Math.floor(h*0.5);
  for (let y=1; y<H-1; y++) {
    for (let x=1; x<W-1; x++) {
      const i=(y*W+x)*4;
      const g = p => 0.299*d[p]+0.587*d[p+1]+0.114*d[p+2];
      const l = Math.abs(4*g(i)-g(i-4)-g(i+4)-g((y-1)*W*4+x*4)-g((y+1)*W*4+x*4));
      s += l;
    }
  }
  return s / (W*H);
};

// Rasm: crop + zoom + kulrang + kontrast + sharpen
const enhance = (canvas, y0, y1) => {
  const sw=canvas.width, sh=canvas.height;
  const cy=Math.floor(sh*y0), ch=Math.floor(sh*(y1-y0));
  const S=3;
  const out=document.createElement("canvas");
  out.width=sw*S; out.height=ch*S;
  const ctx=out.getContext("2d");
  ctx.drawImage(canvas, 0,cy,sw,ch, 0,0,out.width,out.height);
  // Kulrang + kontrast
  const img=ctx.getImageData(0,0,out.width,out.height), d=img.data;
  for (let i=0;i<d.length;i+=4) {
    const g=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const v=g<105?Math.max(0,g*0.4):g>160?Math.min(255,g*1.3+15):(g-105)/55*255;
    d[i]=d[i+1]=d[i+2]=Math.round(v);
  }
  ctx.putImageData(img,0,0);
  // Sharpen (xira uchun)
  applySharpen(ctx, out.width, out.height);
  return out.toDataURL("image/png");
};

// ─── JSHSHIR yordamchi ────────────────────────────────────────────────────────
const isValidJ = n => {
  if (!/^[1-6]\d{13}$/.test(n)) return false;
  const mm=+n.slice(3,5), dd=+n.slice(5,7);
  return mm>=1&&mm<=12&&dd>=1&&dd<=31;
};
const capName = s => s?s.charAt(0).toUpperCase()+s.slice(1).toLowerCase():"";

// ─── PassportScanner ──────────────────────────────────────────────────────────
function PassportScanner({ onFound }) {
  const vRef    = useRef(null);
  const cRef    = useRef(null);
  const strmRef = useRef(null);
  const capRef  = useRef(null);
  const wRef    = useRef(null);
  const busy    = useRef(false);
  const done    = useRef(false);
  const tries   = useRef(0);
  const [status,  setStatus]  = useState("⏳ Kamera tayyorlanmoqda...");
  const [active,  setActive]  = useState(false);
  const [pulse,   setPulse]   = useState(false);
  const [ready,   setReady]   = useState(false);
  const [torch,   setTorch]   = useState(false);
  const [torchOk, setTorchOk] = useState(false);

  // ── Ovoz ──
  const playSuccess = playBeep;

  // ── QR kod (BarcodeDetector) ──
  const tryQR = async v => {
    if (!("BarcodeDetector" in window)) return null;
    try {
      const det = new window.BarcodeDetector({ formats:["qr_code","pdf417","data_matrix"] });
      for (const code of await det.detect(v)) {
        const hits=[...code.rawValue.matchAll(/\d{14}/g)].map(m=>m[0]).filter(isValidJ);
        if (hits.length) return { j:hits[0], name:null };
      }
    } catch {}
    return null;
  };

  // ── MRZ library parse ──
  const tryMrz = text => {
    const lines = text.split("\n")
      .map(l=>l.replace(/[^A-Z0-9<]/g,"").trim())
      .filter(l=>l.length>=20);
    const getName = r => {
      if (!r?.fields?.firstName) return null;
      return `${capName(r.fields.firstName.split("<")[0])} ${capName(r.fields.lastName||"")}`.trim();
    };
    // TD1 — ID karta
    const td1 = lines.filter(l=>l.length>=28&&l.length<=32);
    if (td1.length>=3) {
      try {
        const r = parseMrzLib([td1[0].slice(0,30).padEnd(30,"<"),td1[1].slice(0,30).padEnd(30,"<"),td1[2].slice(0,30).padEnd(30,"<")]);
        const j = r?.fields?.personalNumber?.replace(/</g,"");
        if (j&&isValidJ(j)) return { j, name:getName(r) };
      } catch {}
    }
    // TD3 — Zagranpassport
    const td3 = lines.filter(l=>l.length>=40&&l.length<=48);
    if (td3.length>=2) {
      try {
        const r = parseMrzLib([td3[0].slice(0,44).padEnd(44,"<"),td3[1].slice(0,44).padEnd(44,"<")]);
        const j = r?.fields?.personalNumber?.replace(/</g,"");
        if (j&&isValidJ(j)) return { j, name:getName(r) };
      } catch {}
    }
    // Qo'lda
    for (const line of lines) {
      const hits=[...line.matchAll(/\d{14}/g)].map(m=>m[0]).filter(isValidJ);
      if (hits.length) {
        const m=line.match(/([A-Z]{2,})<<([A-Z]{2,})/);
        return { j:hits[0], name:m?`${capName(m[2])} ${capName(m[1])}`:null };
      }
    }
    return null;
  };

  // ── Torch ──
  const toggleTorch = async () => {
    const track = strmRef.current?.getVideoTracks()[0];
    if (!track) return;
    const newVal = !torch;
    try { await track.applyConstraints({ advanced:[{ torch:newVal }] }); setTorch(newVal); } catch {}
  };

  // ── Worker — ixtiyoriy, ishlamasa ham bo'ladi ──
  useEffect(() => {
    let alive = true;
    Tesseract.createWorker("eng")
      .then(async w => {
        try { await w.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" }); } catch {}
        if (!alive) { w.terminate(); return; }
        wRef.current = w;
      }).catch(() => {});
    // Worker kutmaymiz — kamerani darhol ochamiz
    setReady(true);
    setStatus("Hujjatni kameraga tuting...");
    return () => { alive = false; wRef.current?.terminate(); };
  }, []);

  // ── Kamera — sodda constraints, barcha Androydda ishlaydi ──
  useEffect(() => {
    if (!ready) return;
    const open = async () => {
      // Avval ideal constraints bilan urinib ko'r
      const constraints = [
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: "environment" } },
        { video: true },
      ];
      for (const c of constraints) {
        try {
          const s = await navigator.mediaDevices.getUserMedia(c);
          strmRef.current = s;
          const track = s.getVideoTracks()[0];
          if ("ImageCapture" in window) {
            try { capRef.current = new window.ImageCapture(track); } catch {}
          }
          try { if (track.getCapabilities?.()?.torch) setTorchOk(true); } catch {}
          setTimeout(() => { if (vRef.current) vRef.current.srcObject = s; }, 100);
          setActive(true);
          return;
        } catch {}
      }
      setStatus("❌ Kamera ruxsati berilmadi!");
    };
    open();
    return () => strmRef.current?.getTracks().forEach(t => t.stop());
  }, [ready]);

  // ── Yuqori sifatli kadr ──
  const getFrame = async () => {
    if(capRef.current){
      try{
        const blob=await capRef.current.takePhoto();
        return new Promise(res=>{
          const img=new Image();
          img.onload=()=>{
            const c=document.createElement("canvas");
            c.width=img.width; c.height=img.height;
            c.getContext("2d").drawImage(img,0,0);
            res(c);
          };
          img.src=URL.createObjectURL(blob);
        });
      } catch {}
    }
    const v=vRef.current, c=cRef.current;
    if(!v||!c) return null;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    return c;
  };

  // ── Asosiy skaner ──
  const scan = async () => {
    if (busy.current || done.current) return;
    const v = vRef.current;
    if (!v || v.readyState < 2) return;
    busy.current = true;
    tries.current++;
    setStatus(`🔍 ${tries.current}-urinish...`);

    try {
      // 1) QR kod — bir zumda
      const qr = await tryQR(v);
      if (qr?.j) { finish(qr.j, qr.name, null); return; }

      // Video kadrdan canvas
      const canvas = cRef.current;
      if (!canvas) { busy.current = false; return; }
      canvas.width = v.videoWidth || 640;
      canvas.height = v.videoHeight || 480;
      canvas.getContext("2d").drawImage(v, 0, 0);
      const photo = canvas.toDataURL("image/jpeg", 0.88);

      // 2) To'liq rasm OCR (pastki 50% — MRZ)
      const mrzImg = enhance(canvas, 0.5, 1.0);
      const rec = wRef.current
        ? await wRef.current.recognize(mrzImg)
        : await Tesseract.recognize(mrzImg, "eng");
      const mrz = tryMrz(rec.data.text);
      if (mrz?.j) { finish(mrz.j, mrz.name, photo); return; }

      // 3) Yuqori qism ham tekshirish (Personal number maydoni)
      const topImg = enhance(canvas, 0.0, 0.55);
      const rec2 = wRef.current
        ? await wRef.current.recognize(topImg)
        : await Tesseract.recognize(topImg, "eng");
      const top = tryMrz(rec2.data.text);
      if (top?.j) { finish(top.j, top.name, photo); return; }

      setStatus(`📄 Hujjatni yaqinroq va tekis tuting... (${tries.current})`);
    } catch (e) { console.log("scan err", e); }
    busy.current = false;
  };

  const finish = (j,name,photo) => {
    done.current=true; playSuccess(); setPulse(true);
    strmRef.current?.getTracks().forEach(t=>t.stop());
    if(!photo){ const v=vRef.current,c=cRef.current; if(v&&c){c.width=v.videoWidth;c.height=v.videoHeight;c.getContext("2d").drawImage(v,0,0);photo=c.toDataURL("image/jpeg",0.88);} }
    setTimeout(()=>onFound(j,name,photo),500);
  };

  useEffect(()=>{
    if(!active) return;
    const id=setInterval(scan,1800);
    return ()=>clearInterval(id);
  },[active]);

  return (
    <div>
      <div style={{position:"relative",borderRadius:16,overflow:"hidden",background:"#000",minHeight:200}}>
        {!ready&&(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:"#e8f5ea"}}>
            <div style={{width:36,height:36,border:"3px solid #16a34a",borderTopColor:"transparent",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
            <span style={{color:"#16a34a",fontSize:13,fontWeight:600}}>OCR yuklanmoqda...</span>
          </div>
        )}
        <video ref={vRef} autoPlay playsInline muted style={{width:"100%",display:"block",maxHeight:280,objectFit:"cover",opacity:ready?1:0}}/>

        {/* Scan chizig'i */}
        {active&&!pulse&&(
          <div style={{position:"absolute",left:"4%",right:"4%",height:2.5,borderRadius:2,
            background:"linear-gradient(90deg,transparent,#6366f1,#06b6d4,#6366f1,transparent)",
            animation:"scanLine 1.8s ease-in-out infinite",boxShadow:"0 0 12px rgba(99,102,241,0.8)"}}/>
        )}

        {/* Muvaffaqiyat */}
        {pulse&&(
          <div style={{position:"absolute",inset:0,background:"rgba(34,197,94,0.25)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn .4s"}}>
            <div style={{fontSize:72,animation:"popIn .4s ease"}}>✅</div>
          </div>
        )}

        {/* Burchak belgilari */}
        {[[{top:12,left:12},{borderTop:"2.5px solid #6366f1",borderLeft:"2.5px solid #6366f1"}],
          [{top:12,right:12},{borderTop:"2.5px solid #6366f1",borderRight:"2.5px solid #6366f1"}],
          [{bottom:12,left:12},{borderBottom:"2.5px solid #6366f1",borderLeft:"2.5px solid #6366f1"}],
          [{bottom:12,right:12},{borderBottom:"2.5px solid #6366f1",borderRight:"2.5px solid #6366f1"}]
        ].map(([pos,brd],i)=>(<div key={i} style={{position:"absolute",width:24,height:24,borderRadius:2,pointerEvents:"none",...pos,...brd}}/>))}

        {/* Torch tugmasi */}
        {torchOk&&active&&(
          <button onClick={toggleTorch} style={{position:"absolute",top:12,left:"50%",transform:"translateX(-50%)",
            background:torch?"rgba(251,191,36,0.2)":"rgba(0,0,0,0.5)",color:torch?"#fbbf24":"#fff",
            border:`1.5px solid ${torch?"rgba(251,191,36,0.5)":"rgba(255,255,255,0.2)"}`,
            borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>
            {torch?"🔦 Yoqiq":"🔦 Fonar"}
          </button>
        )}
      </div>
      <canvas ref={cRef} style={{display:"none"}}/>

      {/* Status */}
      <div style={{marginTop:8,padding:"10px 14px",background:"rgba(22,163,74,0.07)",
        border:"1px solid rgba(22,163,74,0.18)",borderRadius:12,
        display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:13,height:13,border:"2.5px solid #16a34a",borderTopColor:"transparent",
          borderRadius:"50%",animation:"spin .8s linear infinite",flexShrink:0}}/>
        <span style={{color:"#15803d",fontSize:12,fontWeight:600}}>{status}</span>
      </div>

      <style>{`
        @keyframes scanLine{0%{top:6%}50%{top:84%}100%{top:6%}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes popIn{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
      `}</style>
    </div>
  );
}

// ─── Camera (yuz rasmi) ───────────────────────────────────────────────────────
function Camera({ onCapture }) {
  const vRef=useRef(null), cRef=useRef(null);
  const [stream,setStream]=useState(null);
  const [on,setOn]=useState(false);
  const [img,setImg]=useState(null);
  const [cnt,setCnt]=useState(null);

  const start=async()=>{
    try{
      const s=await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720} }
      });
      setStream(s); setOn(true);
      setTimeout(()=>{ if(vRef.current) vRef.current.srcObject=s; },100);
    }catch{
      try{
        const s=await navigator.mediaDevices.getUserMedia({video:true});
        setStream(s); setOn(true);
        setTimeout(()=>{ if(vRef.current) vRef.current.srcObject=s; },100);
      }catch{ alert("Kamera ruxsati berilmadi!"); }
    }
  };
  const stop=()=>{ stream?.getTracks().forEach(t=>t.stop()); setStream(null); setOn(false); };
  const snap=()=>{
    const v=vRef.current,c=cRef.current; if(!v||!c) return;
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    const url=c.toDataURL("image/jpeg",.85);
    setImg(url); onCapture(url); stop();
  };
  const countdown=()=>{
    setCnt(3);
    const id=setInterval(()=>setCnt(p=>{ if(p<=1){clearInterval(id);snap();return null;} return p-1; }),1000);
  };
  const retake=()=>{ setImg(null); onCapture(null); start(); };
  useEffect(()=>()=>stream?.getTracks().forEach(t=>t.stop()),[stream]);

  if(img) return (
    <div style={{position:"relative"}}>
      <img src={img} alt="" style={{width:"100%",borderRadius:14,border:"2px solid #22c55e",objectFit:"cover",maxHeight:220}}/>
      <div style={{position:"absolute",top:10,right:10,background:"#22c55e",color:"#fff",borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:700}}>✓ Saqlandi</div>
      <button onClick={retake} style={btnStyle("#ef4444","rgba(239,68,68,0.08)")}>🔄 Qayta olish</button>
    </div>
  );
  if(on) return (
    <div>
      <div style={{position:"relative",borderRadius:14,overflow:"hidden"}}>
        <video ref={vRef} autoPlay playsInline muted style={{width:"100%",display:"block",maxHeight:220,objectFit:"cover"}}/>
        {cnt&&<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <span style={{fontSize:80,fontWeight:900,color:"#fff",animation:"popIn .4s"}}>{cnt}</span>
        </div>}
      </div>
      <canvas ref={cRef} style={{display:"none"}}/>
      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={countdown} disabled={!!cnt} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",true)}>
          📸 3... 2... 1...
        </button>
        <button onClick={snap} disabled={!!cnt} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",false,true)}>📸</button>
        <button onClick={stop} style={btnStyle("#ef4444","#ef4444",false,true)}>✕</button>
      </div>
    </div>
  );
  return (
    <button onClick={start} style={btnStyle("#6366f1","linear-gradient(135deg,#6366f1,#8b5cf6)",true)}>
      📷 Yuz rasmini olish
    </button>
  );
}

const btnStyle=(color,bg,full=false,sm=false)=>({
  width:full?"100%":"auto", padding:sm?"12px 16px":"13px 18px",
  background:bg, color:"#fff", border:"none", borderRadius:12,
  fontWeight:700, fontSize:14, cursor:"pointer", flex:full?undefined:1,
  boxShadow:`0 4px 12px ${color}33`
});

// ─── Dizayn konstantalar — Premium Dark Glassmorphism ─────────────────────────
const C = {
  bg:      "#060b18",
  card:    "rgba(15,20,40,0.75)",
  card2:   "rgba(20,28,55,0.6)",
  border:  "rgba(99,102,241,0.15)",
  blue:    "#6366f1",
  blue2:   "#818cf8",
  gold:    "#f59e0b",
  gold2:   "#fbbf24",
  green:   "#10b981",
  red:     "#ef4444",
  text:    "#e2e8f0",
  muted:   "#64748b",
  dim:     "rgba(99,102,241,0.12)",
  accent:  "#06b6d4",
};

const G = {
  blue:  `linear-gradient(135deg,#6366f1,#8b5cf6)`,
  gold:  `linear-gradient(135deg,#f59e0b,#fbbf24)`,
  green: `linear-gradient(135deg,#10b981,#06d6a0)`,
  card:  `linear-gradient(160deg,rgba(15,20,40,0.8),rgba(20,28,55,0.5))`,
  bg:    `linear-gradient(160deg,#060b18 0%,#0c1528 50%,#060b18 100%)`,
};

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [u,setU]=useState(""), [p,setP]=useState(""), [err,setErr]=useState(""), [loading,setLoading]=useState(false);
  const go=()=>{
    const x=USERS[u];
    if(x&&x.password===p){ setLoading(true); setTimeout(()=>onLogin({username:u,...x}),700); }
    else setErr("Login yoki parol noto'g'ri!");
  };
  const inp={
    padding:"14px 18px", background:"rgba(15,20,40,0.6)",
    border:`1.5px solid rgba(99,102,241,0.2)`, borderRadius:12,
    color:"#e2e8f0", fontSize:15, outline:"none",
    width:"100%", boxSizing:"border-box", fontFamily:"'Inter',system-ui,sans-serif",
    transition:"all .3s", backdropFilter:"blur(8px)",
  };
  return (
    <div style={{minHeight:"100vh",background:G.bg,
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"24px 20px",fontFamily:"'Inter',system-ui,sans-serif",position:"relative",overflow:"hidden"}}>

      {/* Background glow orbs */}
      <div style={{position:"absolute",width:400,height:400,background:"radial-gradient(circle,rgba(99,102,241,0.15),transparent 70%)",top:"-10%",right:"-10%",borderRadius:"50%",pointerEvents:"none"}}/>
      <div style={{position:"absolute",width:350,height:350,background:"radial-gradient(circle,rgba(6,182,212,0.1),transparent 70%)",bottom:"-5%",left:"-10%",borderRadius:"50%",pointerEvents:"none"}}/>

      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
        @keyframes glow{0%,100%{opacity:.7}50%{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes scanLine{0%{top:6%}50%{top:84%}100%{top:6%}}
        @keyframes popIn{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        @keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
        input::placeholder{color:rgba(148,163,184,0.5)}
        input:focus{border-color:#6366f1!important;box-shadow:0 0 0 3px rgba(99,102,241,0.15)!important}
        button:active{transform:scale(0.97)}
      `}</style>

      <div style={{width:"100%",maxWidth:400,animation:"fadeUp .6s ease",position:"relative",zIndex:1}}>
        {/* Gerb */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:72,height:72,background:"linear-gradient(135deg,rgba(99,102,241,0.2),rgba(6,182,212,0.2))",
            borderRadius:20,display:"inline-flex",alignItems:"center",justifyContent:"center",
            fontSize:36,marginBottom:16,border:"1px solid rgba(99,102,241,0.2)",
            boxShadow:"0 0 40px rgba(99,102,241,0.2)",backdropFilter:"blur(12px)"}}>🏛️</div>
          <div style={{color:C.gold2,fontSize:10,fontWeight:700,letterSpacing:4,
            textTransform:"uppercase",marginBottom:8}}>O'zbekiston Respublikasi</div>
          <h1 style={{color:"#fff",fontSize:22,fontWeight:900,margin:"0 0 6px",letterSpacing:.5}}>
            MFY Monitoring Tizimi
          </h1>
          <div style={{color:C.muted,fontSize:13}}>Fuqarolarni ro'yxatga olish</div>
        </div>

        {/* Chiziq */}
        <div style={{height:1,background:`linear-gradient(90deg,transparent,rgba(99,102,241,0.4),rgba(6,182,212,0.4),transparent)`,marginBottom:32,borderRadius:2}}/>

        {/* Forma */}
        <div style={{background:"rgba(15,20,40,0.7)",borderRadius:24,padding:"32px 28px",
          border:"1px solid rgba(99,102,241,0.15)",backdropFilter:"blur(20px)",
          boxShadow:"0 8px 40px rgba(0,0,0,0.4),0 0 80px rgba(99,102,241,0.05)"}}>
          <div style={{display:"flex",flexDirection:"column",gap:18}}>
            <div>
              <label style={{color:C.muted,fontSize:11,fontWeight:600,display:"block",
                marginBottom:8,textTransform:"uppercase",letterSpacing:1.5}}>Foydalanuvchi nomi</label>
              <input value={u} onChange={e=>{setU(e.target.value);setErr("");}}
                placeholder="Loginni kiriting" style={inp}/>
            </div>
            <div>
              <label style={{color:C.muted,fontSize:11,fontWeight:600,display:"block",
                marginBottom:8,textTransform:"uppercase",letterSpacing:1.5}}>Parol</label>
              <input type="password" value={p} onChange={e=>{setP(e.target.value);setErr("");}}
                placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()} style={inp}/>
            </div>
            {err&&(
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
                background:"rgba(239,68,68,0.1)",borderRadius:10,
                border:"1px solid rgba(239,68,68,0.25)"}}>
                <span style={{fontSize:14}}>⚠️</span>
                <span style={{color:"#f87171",fontSize:13,fontWeight:500}}>{err}</span>
              </div>
            )}
            <button onClick={go} disabled={loading} style={{
              marginTop:4,padding:15,background:loading?"rgba(99,102,241,0.2)":G.blue,
              color:"#fff",border:"none",borderRadius:12,fontWeight:700,
              fontSize:15,cursor:loading?"wait":"pointer",
              boxShadow:loading?"none":"0 8px 28px rgba(99,102,241,0.35)",
              transition:"all .3s",letterSpacing:.3}}>
              {loading
                ? <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                    <span style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",
                      borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite",display:"inline-block"}}/>
                    Kirilmoqda...
                  </span>
                : "Tizimga kirish →"}
            </button>
          </div>
        </div>

        {/* Demo */}
        <div style={{marginTop:16,padding:"14px 18px",background:"rgba(15,20,40,0.5)",
          borderRadius:14,border:"1px solid rgba(99,102,241,0.1)",backdropFilter:"blur(12px)"}}>
          <div style={{color:C.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>
            Demo kirish
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:12}}>
            <span style={{fontFamily:"'Inter',monospace",color:"rgba(148,163,184,0.8)"}}>admin / admin123</span>
            <span style={{color:C.gold2,fontWeight:700,fontSize:11}}>Boshliq</span>
            <span style={{fontFamily:"'Inter',monospace",color:"rgba(148,163,184,0.8)"}}>hodim1 / 1234</span>
            <span style={{color:"#818cf8",fontWeight:700,fontSize:11}}>Hodim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hodim (iPhone Style App) ──────────────────────────────────────────────────
function Hodim({ user, records, onLogout }) {
  const [tab, setTab] = useState("home"); // home, scan, history
  const [mfy, setMfy] = useState(null);
  const [face, setFace] = useState(null);
  const [passport, setPassport] = useState(null);
  const [name, setName] = useState("");
  const [jshshir, setJshshir] = useState("");
  const [coords, setCoords] = useState(null);
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      p => setCoords({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
      () => setCoords({ lat: "40.6367", lng: "71.5567" })
    );
  }, []);

  const show = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const submit = async () => {
    if (!mfy || !face || !passport || !name.trim() || jshshir.length !== 14) {
      show("Barcha maydonlarni to'ldiring!", "err");
      return;
    }
    setSending(true);
    try {
      const rec = {
        id: Date.now(), hodim: user.username, hodimName: user.name, mfy,
        fullName: name.trim(), jshshir, facePhoto: face, passportPhoto: passport,
        coords, timestamp: new Date().toISOString()
      };
      await addRecord(rec);
      setSuccess(rec);
      setFace(null); setPassport(null); setName(""); setJshshir("");
      setTab("home");
    } catch (e) {
      show("Xatolik! Internetni tekshiring.", "err");
    }
    setSending(false);
  };

  const myRecords = records.filter(r => r.hodim === user.username);
  const todayCount = myRecords.filter(r => fmtDate(new Date(r.timestamp)) === todayStr()).length;

  // ── Tab: Home (MFY Selection) ──
  const HomeView = () => (
    <div style={{ padding: "20px 16px 100px", animation: "fadeUp .4s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 900 }}>Salom!</h1>
          <p style={{ color: C.muted, fontSize: 14 }}>Mahalla monitoringini boshlang</p>
        </div>
        <div style={{ width: 44, height: 44, background: "rgba(255,255,255,0.05)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👷</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 28 }}>
        <div style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", padding: 16, borderRadius: 20 }}>
          <div style={{ fontSize: 12, color: C.blue2, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Bugun</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff" }}>{todayCount}</div>
        </div>
        <div style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: 16, borderRadius: 20 }}>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Jami</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff" }}>{myRecords.length}</div>
        </div>
      </div>

      <h2 style={{ color: "#fff", fontSize: 18, fontWeight: 800, marginBottom: 16 }}>Mahalla Tanlang</h2>
      <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: 13, color: C.muted }}>🔍</span>
        <input 
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Qidirish..." 
          style={{ width: "100%", padding: "12px 14px 12px 40px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, color: "#fff", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {MFY_LIST.filter(m => m.name.toLowerCase().includes(search.toLowerCase())).map(m => {
          const count = myRecords.filter(r => r.mfy?.id === m.id).length;
          const isSelected = mfy?.id === m.id;
          return (
            <button key={m.id} onClick={() => { setMfy(m); setTab("scan"); }} style={{
              padding: "16px", background: isSelected ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.03)",
              border: isSelected ? "1px solid #6366f1" : "1px solid rgba(255,255,255,0.05)",
              borderRadius: 18, color: "#fff", textAlign: "left", cursor: "pointer", transition: "all .2s",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              {count > 0 && <span style={{ fontSize: 11, background: "rgba(99,102,241,0.3)", padding: "2px 8px", borderRadius: 8, color: C.blue2 }}>{count} ta</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Tab: Scan (Form) ──
  const ScanView = () => (
    <div style={{ padding: "20px 16px 120px", animation: "fadeUp .4s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>Yangi Yozuv</h1>
        {mfy && <div style={{ fontSize: 12, background: "rgba(99,102,241,0.15)", padding: "4px 12px", borderRadius: 12, color: C.blue2, fontWeight: 700 }}>{mfy.name}</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Step 1: Face */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", padding: 16, borderRadius: 24 }}>
          <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 12 }}>1. YUZ RASMI</label>
          <Camera onCapture={setFace} />
        </div>

        {/* Step 2: Passport */}
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", padding: 16, borderRadius: 24 }}>
          <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 12 }}>2. PASSPORT / ID SKANER</label>
          {passport ? (
            <div style={{ position: "relative" }}>
              <img src={passport} style={{ width: "100%", borderRadius: 16, border: "2px solid #6366f1" }} alt="" />
              <button onClick={() => { setPassport(null); setJshshir(""); }} style={{ marginTop: 8, width: "100%", padding: 10, background: "rgba(239,68,68,0.1)", border: "none", borderRadius: 12, color: "#f87171", fontWeight: 700 }}>🔄 Qayta olish</button>
            </div>
          ) : <PassportScanner onFound={(j, fn, p) => { setJshshir(j); setPassport(p); if (fn) setName(fn); }} />}
        </div>

        {/* Step 3: Name & JSHSHIR */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 8 }}>F.I.SH</label>
            <input 
              value={name} onChange={e => setName(e.target.value)}
              placeholder="To'liq ism" 
              style={{ width: "100%", padding: 16, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, color: "#fff", fontSize: 16, outline: "none" }}
            />
          </div>
          <div>
            <label style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 8 }}>JSHSHIR (14 ta raqam)</label>
            <input 
              value={jshshir} onChange={e => setJshshir(e.target.value.replace(/\D/g, "").slice(0, 14))}
              placeholder="50701..." 
              style={{ width: "100%", padding: 16, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, color: "#fff", fontSize: 18, fontFamily: "monospace", letterSpacing: 2, outline: "none" }}
            />
          </div>
        </div>

        <button 
          onClick={submit} disabled={sending || !mfy || !face || !passport || !name || jshshir.length !== 14}
          style={{
            padding: 18, background: sending ? "rgba(99,102,241,0.5)" : G.blue, border: "none", borderRadius: 20,
            color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", transition: "all .3s",
            boxShadow: "0 10px 20px rgba(99,102,241,0.3)"
          }}
        >
          {sending ? "Yuborilmoqda..." : "Yozuvni Saqlash"}
        </button>
      </div>
    </div>
  );

  // ── Tab: History ──
  const HistoryView = () => (
    <div style={{ padding: "20px 16px 100px", animation: "fadeUp .4s" }}>
      <h1 style={{ color: "#fff", fontSize: 22, fontWeight: 900, marginBottom: 20 }}>Yozuvlar Tarixi</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {myRecords.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>Hali yozuvlar yo'q</div>
        ) : [...myRecords].reverse().map(r => (
          <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", padding: 14, borderRadius: 20, display: "flex", gap: 12, alignItems: "center" }}>
            <img src={r.facePhoto} style={{ width: 50, height: 50, borderRadius: 14, objectFit: "cover" }} alt="" />
            <div>
              <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>{r.fullName}</div>
              <div style={{ color: C.muted, fontSize: 11 }}>{r.mfy?.name} • {fmt(r.timestamp)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 430, background: "#0a0a0a", minHeight: "100vh", position: "relative", overflow: "hidden" }}>
        
        {/* iOS style Status Bar Spacer */}
        <div style={{ height: 44, width: "100%" }} />

        {/* Content Area */}
        <div style={{ height: "calc(100vh - 124px)", overflowY: "auto" }}>
          {tab === "home" && <HomeView />}
          {tab === "scan" && <ScanView />}
          {tab === "history" && <HistoryView />}
        </div>

        {/* Success Overlay */}
        {success && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(20px)" }}>
            <div style={{ textAlign: "center", animation: "popIn .5s ease" }}>
              <div style={{ width: 80, height: 80, background: G.green, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, margin: "0 auto 24px", boxShadow: "0 0 40px rgba(16,185,129,0.4)" }}>✓</div>
              <h2 style={{ color: "#fff", fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Saqlandi!</h2>
              <p style={{ color: C.muted, marginBottom: 32 }}>Ma'lumotlar bazaga yuborildi.</p>
              <button onClick={() => setSuccess(null)} style={{ padding: "16px 40px", background: G.blue, border: "none", borderRadius: 16, color: "#fff", fontWeight: 700 }}>Davom Etish</button>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div style={{ position: "fixed", top: 60, left: "50%", transform: "translateX(-50%)", zIndex: 2000, background: toast.type === "err" ? "#ef4444" : "#6366f1", color: "#fff", padding: "12px 24px", borderRadius: 50, fontWeight: 700, fontSize: 14, boxShadow: "0 10px 20px rgba(0,0,0,0.5)", animation: "fadeUp .3s" }}>
            {toast.msg}
          </div>
        )}

        {/* Bottom Tab Bar (iPhone Style) */}
        <div style={{ 
          position: "absolute", bottom: 0, left: 0, right: 0, height: 84, 
          background: "rgba(20,20,20,0.85)", backdropFilter: "blur(20px)", 
          borderTop: "0.5px solid rgba(255,255,255,0.1)",
          display: "flex", justifyContent: "space-around", alignItems: "center", paddingBottom: 20
        }}>
          {[
            { id: "home", icon: "🏠", label: "Asosiy" },
            { id: "scan", icon: "📸", label: "Skaner" },
            { id: "history", icon: "🕒", label: "Tarix" },
            { id: "exit", icon: "🚪", label: "Chiqish" }
          ].map(t => (
            <button 
              key={t.id} 
              onClick={() => t.id === "exit" ? onLogout() : setTab(t.id)}
              style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", opacity: tab === t.id || t.id === "exit" ? 1 : 0.4, transition: "all .3s" }}
            >
              <span style={{ fontSize: 24 }}>{t.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: tab === t.id ? C.blue2 : "#fff", textTransform: "uppercase" }}>{t.label}</span>
            </button>
          ))}
        </div>

      </div>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes popIn { 0% { transform: scale(0.5); opacity: 0; } 70% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
      `}</style>
    </div>
  );
}

const lbl={color:C.muted,fontSize:11,fontWeight:700,display:"block",marginBottom:8,
  textTransform:"uppercase",letterSpacing:1.1};
const inputSt=ok=>({
  width:"100%",padding:"13px 16px",
  background:ok?"rgba(99,102,241,0.08)":"rgba(15,20,40,0.6)",
  border:`1.5px solid ${ok?"rgba(99,102,241,0.35)":"rgba(99,102,241,0.15)"}`,
  borderRadius:12,color:C.text,fontSize:15,outline:"none",
  boxSizing:"border-box",fontFamily:"'Inter',system-ui,sans-serif",transition:"all .2s",
  backdropFilter:"blur(8px)",
});

// ─── Boshliq ──────────────────────────────────────────────────────────────────
function Boshliq({ user, records, onLogout }) {
  const [hFilter,setHFilter]=useState(null);
  const [mFilter,setMFilter]=useState(null);
  const [dateF,setDateF]=useState("all");
  const [search,setSearch]=useState("");
  const [detail,setDetail]=useState(null);

  const hodimlar=Object.entries(USERS).filter(([,u])=>u.role==="hodim");
  const todayAll=records.filter(r=>fmtDate(new Date(r.timestamp))===todayStr()).length;

  const filtered=records.filter(r=>{
    if(hFilter&&r.hodim!==hFilter) return false;
    if(mFilter&&r.mfy?.id!==mFilter) return false;
    if(dateF==="today"&&fmtDate(new Date(r.timestamp))!==todayStr()) return false;
    if(dateF==="week"){const d=new Date();d.setDate(d.getDate()-7);if(new Date(r.timestamp)<d)return false;}
    if(search){const q=search.toLowerCase();if(!r.fullName?.toLowerCase().includes(q)&&!r.jshshir?.includes(q)&&!r.mfy?.name?.toLowerCase().includes(q))return false;}
    return true;
  });

  const exportCSV=()=>{
    const h=["#","Ism","JSHSHIR","MFY","Hodim","Sana","Vaqt","Joylashuv"];
    const rows=records.map((r,i)=>[i+1,r.fullName,r.jshshir,r.mfy?.name,r.hodimName,fmtDate(r.timestamp),fmt(r.timestamp),`${r.coords?.lat},${r.coords?.lng}`]);
    const csv=[h,...rows].map(r=>r.map(v=>`"${v||""}"`).join(",")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob(["﻿"+csv],{type:"text/csv;charset=utf-8"}));
    a.download=`mfy_${todayStr().replace(/\./g,"-")}.csv`; a.click();
  };

  const hdr={background:"rgba(10,15,30,0.85)",backdropFilter:"blur(20px)",
    padding:"12px 16px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:50,
    boxShadow:"0 2px 12px rgba(0,0,0,0.3)"};
  const srch2={width:"100%",padding:"10px 14px 10px 38px",background:"rgba(15,20,40,0.6)",
    border:`1px solid rgba(99,102,241,0.2)`,borderRadius:11,color:C.text,fontSize:13,
    outline:"none",boxSizing:"border-box",fontFamily:"'Inter',system-ui,sans-serif",
    backdropFilter:"blur(8px)"};
  const chip=(on)=>({padding:"6px 14px",borderRadius:9,fontWeight:700,
    fontSize:11,cursor:"pointer",letterSpacing:.3,
    background:on?G.blue:"rgba(15,20,40,0.6)",color:on?"#fff":C.muted,
    border:on?`1px solid transparent`:`1px solid rgba(99,102,241,0.2)`});

  if(detail) return (
    <div style={{minHeight:"100vh",background:G.bg,fontFamily:"'Inter',system-ui,sans-serif",color:C.text}}>
      <div style={{...hdr,display:"flex",alignItems:"center",gap:12}}>
        <button onClick={()=>setDetail(null)}
          style={{background:"none",border:"none",color:C.blue2,fontWeight:700,fontSize:14,cursor:"pointer",padding:0}}>
          ← Orqaga
        </button>
        <span style={{color:C.muted,fontSize:13}}>Fuqaro ma'lumotlari</span>
      </div>
      <div style={{padding:"18px 16px",display:"flex",flexDirection:"column",gap:14}}>
        {/* Asosiy info */}
        <div style={{background:G.card,borderRadius:18,padding:"18px 16px",border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14,gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{fontWeight:900,fontSize:19,color:"#fff"}}>{detail.fullName}</div>
              <div style={{color:C.blue2,fontFamily:"monospace",fontSize:14,letterSpacing:2,marginTop:5,
                background:"rgba(99,102,241,0.12)",padding:"3px 10px",borderRadius:8,display:"inline-block"}}>
                {detail.jshshir}
              </div>
            </div>
            <span style={{background:"rgba(245,158,11,0.12)",color:C.gold2,padding:"5px 12px",
              borderRadius:10,fontSize:11,fontWeight:700,border:`1px solid rgba(245,158,11,0.25)`,flexShrink:0}}>
              {detail.mfy?.name}
            </span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {[["📅",fmtDate(new Date(detail.timestamp))],["🕐",fmt(detail.timestamp)],
              ["👤",detail.hodimName],["📍",`${detail.coords?.lat?.slice(0,8)}, ${detail.coords?.lng?.slice(0,8)}`]
            ].map(([ic,v],k)=>(
              <div key={k} style={{padding:"8px 11px",background:"rgba(15,20,40,0.5)",
                borderRadius:9,fontSize:11,color:C.muted,border:`1px solid ${C.border}`}}>
                {ic} <span style={{color:"#fff"}}>{v}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Rasmlar */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {[["Yuz rasmi",detail.facePhoto],["Hujjat",detail.passportPhoto]].map(([l,s])=>(
            <div key={l}>
              <div style={{color:C.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",
                letterSpacing:1,marginBottom:7}}>{l}</div>
              {s
                ? <img src={s} alt={l} style={{width:"100%",borderRadius:13,border:`1px solid ${C.border}`}}/>
                : <div style={{width:"100%",paddingTop:"75%",background:C.card2,borderRadius:13,
                    border:`1px solid ${C.border}`,position:"relative"}}>
                    <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
                      justifyContent:"center",color:C.muted,fontSize:12}}>Yo'q</span>
                  </div>
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Segoe UI',system-ui,sans-serif",color:C.text}}>
      {/* Header */}
      <div style={{...hdr,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,background:G.gold,borderRadius:9,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,
            boxShadow:"0 4px 12px rgba(245,158,11,0.35)"}}>🏛️</div>
          <div>
            <div style={{fontWeight:800,fontSize:13,color:"#fff"}}>Boshqaruv paneli</div>
            <div style={{color:C.gold2,fontSize:10,fontWeight:600}}>
              Jami: {records.length} · Bugun: {todayAll}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={exportCSV} style={{padding:"6px 12px",background:"rgba(99,102,241,0.1)",
            color:C.blue2,border:`1px solid rgba(99,102,241,0.2)`,borderRadius:9,
            fontWeight:700,fontSize:11,cursor:"pointer"}}>⬇ Excel</button>
          <button onClick={onLogout} style={{padding:"6px 12px",background:"rgba(239,68,68,0.1)",
            color:"#f87171",border:"1px solid rgba(239,68,68,0.2)",borderRadius:9,
            fontWeight:600,fontSize:11,cursor:"pointer"}}>Chiqish</button>
        </div>
      </div>

      {/* Statistika */}
      <div style={{padding:"16px 16px 0",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {icon:"📊",l:"Jami",v:records.length,c:C.blue2,bg:"rgba(99,102,241,0.1)"},
          {icon:"📅",l:"Bugun",v:todayAll,c:C.green,bg:"rgba(16,185,129,0.1)"},
          {icon:"🏘",l:"MFY",v:[...new Set(records.map(r=>r.mfy?.id))].filter(Boolean).length,c:C.gold2,bg:"rgba(245,158,11,0.1)"},
        ].map((s,i)=>(
          <div key={i} style={{background:s.bg,borderRadius:14,padding:"13px 10px",
            border:`1px solid ${s.c}22`,textAlign:"center"}}>
            <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
            <div style={{color:s.c,fontSize:26,fontWeight:900,lineHeight:1}}>{s.v}</div>
            <div style={{color:C.muted,fontSize:10,fontWeight:700,marginTop:3,textTransform:"uppercase",letterSpacing:.8}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Hodimlar */}
      <div style={{padding:"14px 16px 0"}}>
        <div style={{color:C.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",
          letterSpacing:1,marginBottom:8}}>Hodimlar faolligi</div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {hodimlar.map(([un,ud])=>{
            const today=records.filter(r=>r.hodim===un&&fmtDate(new Date(r.timestamp))===todayStr()).length;
            const total=records.filter(r=>r.hodim===un).length;
            const max=Math.max(1,...hodimlar.map(([u])=>records.filter(r=>r.hodim===u&&fmtDate(new Date(r.timestamp))===todayStr()).length));
            const active=hFilter===un;
            return(
              <button key={un} onClick={()=>setHFilter(active?null:un)}
                style={{padding:"11px 13px",
                  background:active?"rgba(99,102,241,0.12)":G.card,
                  border:active?`1px solid rgba(99,102,241,0.3)`:`1px solid ${C.border}`,
                  borderRadius:12,cursor:"pointer",textAlign:"left",transition:"all .15s",backdropFilter:"blur(8px)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <span style={{color:"#fff",fontWeight:600,fontSize:13}}>{ud.name}</span>
                  <span style={{fontSize:11,color:C.muted}}>
                    Bugun <b style={{color:C.blue2}}>{today}</b>  ·  Jami <b style={{color:C.blue2}}>{total}</b>
                  </span>
                </div>
                <div style={{height:3,background:"rgba(99,102,241,0.1)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,transition:"width .6s",
                    width:`${Math.round(today/max*100)}%`,
                    background:today>0?"linear-gradient(90deg,#6366f1,#06b6d4)":"transparent"}}/>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter */}
      <div style={{padding:"12px 16px 0"}}>
        <div style={{position:"relative",marginBottom:8}}>
          <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:13}}>🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Ism, JSHSHIR yoki MFY..." style={srch2}/>
        </div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {[["all","Barchasi"],["today","Bugun"],["week","Hafta"]].map(([v,l])=>(
            <button key={v} onClick={()=>setDateF(v)} style={chip(dateF===v)}>{l}</button>
          ))}
          {hFilter&&<button onClick={()=>setHFilter(null)}
            style={{padding:"6px 11px",background:"rgba(239,68,68,0.1)",color:"#f87171",
              border:"1px solid rgba(239,68,68,0.2)",borderRadius:9,fontWeight:700,fontSize:11,cursor:"pointer"}}>
            ✕ {USERS[hFilter]?.name}
          </button>}
        </div>
      </div>

      {/* Ro'yxat */}
      <div style={{padding:"10px 16px 36px"}}>
        <div style={{color:C.muted,fontSize:10,fontWeight:700,textTransform:"uppercase",
          letterSpacing:.8,marginBottom:8}}>Yozuvlar — {filtered.length} ta</div>
        {filtered.length===0?(
          <div style={{textAlign:"center",padding:48}}>
            <div style={{fontSize:36,marginBottom:10,filter:"grayscale(1)",opacity:.3}}>📭</div>
            <div style={{color:C.muted,fontWeight:600,fontSize:14}}>Yozuvlar topilmadi</div>
          </div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {[...filtered].reverse().map((r,i)=>(
              <button key={r.id||i} onClick={()=>setDetail(r)}
                style={{padding:"11px 13px",background:G.card,
                  border:`1px solid ${C.border}`,borderRadius:13,
                  cursor:"pointer",textAlign:"left",display:"flex",gap:11,alignItems:"center",
                  transition:"all .15s",backdropFilter:"blur(8px)"}}>
                {r.facePhoto
                  ? <img src={r.facePhoto} alt="" style={{width:44,height:44,borderRadius:11,
                      objectFit:"cover",border:`1px solid ${C.border}`,flexShrink:0}}/>
                  : <div style={{width:44,height:44,borderRadius:11,background:"rgba(99,102,241,0.15)",
                      flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:18,color:C.blue2}}>👤</div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#fff",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.fullName}</div>
                  <div style={{color:C.blue2,fontFamily:"monospace",fontSize:11,
                    letterSpacing:1,marginTop:3}}>{r.jshshir}</div>
                  <div style={{color:C.muted,fontSize:10,marginTop:2,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.mfy?.name} · {r.hodimName} · {fmt(r.timestamp)}
                  </div>
                </div>
                <span style={{color:C.muted,fontSize:16,flexShrink:0}}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Landing Page ─────────────────────────────────────────────────────────────
function Landing({ onSelect }) {
  return (
    <div style={{
      minHeight: "100vh", background: G.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
      fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{
        width: 80, height: 80, background: G.blue, borderRadius: 24,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40,
        marginBottom: 24, boxShadow: "0 20px 40px rgba(99,102,241,0.3)", animation: "popIn .6s ease"
      }}>🏛️</div>
      
      <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 900, marginBottom: 8 }}>Monitoring</h1>
      <p style={{ color: C.muted, fontSize: 15, marginBottom: 40 }}>O'zbekiston Respublikasi MFY Monitoring Tizimi</p>

      <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={() => onSelect("hodim")} style={{
          padding: "20px", background: G.blue, border: "none",
          borderRadius: 22, color: "#fff", fontSize: 18, fontWeight: 800, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
          boxShadow: "0 20px 40px rgba(99,102,241,0.3)", transition: "all .3s"
        }}>
          🚀 Ishni Boshlash
        </button>
      </div>

      <div style={{ marginTop: "auto", paddingBottom: 20, color: C.muted, fontSize: 12, letterSpacing: 1 }}>
        VERSION 2.0 • MOBILE OPTIMIZED
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("landing");
  const [user, setUser] = useState(null);
  const [records, setRecords] = useState([]);

  // URL orqali Adminni aniqlash (?admin)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("admin")) {
      setView("admin_login");
    }
  }, []);

  // Firebase real-time
  useEffect(() => {
    const unsub = listenRecords(setRecords);
    return () => unsub();
  }, []);

  if (view === "landing") return <Landing onSelect={setView} />;
  
  if (view === "hodim") return (
    <Hodim 
      user={{ username: "mobil_hodim", name: "Mobil Hodim" }} 
      records={records} 
      setRecords={setRecords} 
      onLogout={() => setView("landing")} 
    />
  );

  if (view === "admin_login") return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setView("landing")} style={{
        position: "absolute", top: 20, left: 20, zIndex: 100, background: "none", border: "none",
        color: C.muted, fontSize: 14, fontWeight: 600, cursor: "pointer"
      }}>← Orqaga</button>
      <Login onLogin={(u) => { setUser(u); setView("admin_dashboard"); }} />
    </div>
  );

  if (view === "admin_dashboard") return (
    <Boshliq user={user} records={records} onLogout={() => { setUser(null); setView("landing"); }} />
  );

  return <Landing onSelect={setView} />;
}
