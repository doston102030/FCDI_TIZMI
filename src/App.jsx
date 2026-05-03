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

// ─── Dizayn konstantalar — Oq + Yashil ───────────────────────────────────────
const C = {
  bg:      "#f4faf5",
  card:    "#ffffff",
  card2:   "#f0f7f1",
  border:  "rgba(22,163,74,0.15)",
  blue:    "#16a34a",
  blue2:   "#15803d",
  gold:    "#ca8a04",
  gold2:   "#d97706",
  green:   "#16a34a",
  red:     "#dc2626",
  text:    "#0f2318",
  muted:   "#6b8f72",
  dim:     "#d1e8d4",
};

const G = {
  blue:  `linear-gradient(135deg,#15803d,#22c55e)`,
  gold:  `linear-gradient(135deg,#ca8a04,#fbbf24)`,
  green: `linear-gradient(135deg,#15803d,#22c55e)`,
  card:  `linear-gradient(160deg,#ffffff,#f0f7f1)`,
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
    padding:"13px 16px", background:"#ffffff",
    border:`1.5px solid rgba(22,163,74,0.25)`, borderRadius:12,
    color:C.text, fontSize:15, outline:"none",
    width:"100%", boxSizing:"border-box", fontFamily:"inherit",
    transition:"border .2s", boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
  };
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#f0faf2 0%,#e8f5eb 50%,#f0faf2 100%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"24px 20px",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>

      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
        @keyframes glow{0%,100%{opacity:.7}50%{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes scanLine{0%{top:6%}50%{top:84%}100%{top:6%}}
        @keyframes popIn{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        input::placeholder{color:#9ab89e}
        input:focus{border-color:#16a34a!important;box-shadow:0 0 0 3px rgba(22,163,74,0.12)}
        button:active{transform:scale(0.98)}
      `}</style>

      <div style={{width:"100%",maxWidth:370,animation:"fadeUp .6s ease"}}>
        {/* Gerb */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:52,marginBottom:14,filter:"drop-shadow(0 0 20px rgba(212,149,26,0.5))",
            animation:"glow 3s ease-in-out infinite"}}>🏛️</div>
          <div style={{color:C.gold2,fontSize:10,fontWeight:700,letterSpacing:3,
            textTransform:"uppercase",marginBottom:6}}>O'zbekiston Respublikasi</div>
          <h1 style={{color:C.text,fontSize:20,fontWeight:900,margin:"0 0 4px",letterSpacing:.5}}>
            MFY Monitoring Tizimi
          </h1>
          <div style={{color:C.muted,fontSize:12}}>Fuqarolarni ro'yxatga olish</div>
        </div>

        {/* Chiziq */}
        <div style={{height:2,background:`linear-gradient(90deg,transparent,#16a34a,transparent)`,marginBottom:28,borderRadius:2}}/>

        {/* Forma */}
        <div style={{background:"#ffffff",borderRadius:20,padding:"28px 24px",
          border:"1px solid rgba(22,163,74,0.15)",
          boxShadow:"0 8px 40px rgba(22,163,74,0.10),0 2px 8px rgba(0,0,0,0.06)"}}>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <label style={{color:C.muted,fontSize:11,fontWeight:700,display:"block",
                marginBottom:7,textTransform:"uppercase",letterSpacing:1.2}}>Foydalanuvchi nomi</label>
              <input value={u} onChange={e=>{setU(e.target.value);setErr("");}}
                placeholder="Loginni kiriting" style={inp}
                onFocus={e=>e.target.style.borderColor=C.blue}
                onBlur={e=>e.target.style.borderColor=C.border}/>
            </div>
            <div>
              <label style={{color:C.muted,fontSize:11,fontWeight:700,display:"block",
                marginBottom:7,textTransform:"uppercase",letterSpacing:1.2}}>Parol</label>
              <input type="password" value={p} onChange={e=>{setP(e.target.value);setErr("");}}
                placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()} style={inp}
                onFocus={e=>e.target.style.borderColor=C.blue}
                onBlur={e=>e.target.style.borderColor=C.border}/>
            </div>
            {err&&(
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
                background:"rgba(229,62,62,0.08)",borderRadius:10,
                border:"1px solid rgba(229,62,62,0.2)"}}>
                <span style={{fontSize:14}}>⚠️</span>
                <span style={{color:"#fc8181",fontSize:13}}>{err}</span>
              </div>
            )}
            <button onClick={go} disabled={loading} style={{
              marginTop:4,padding:14,background:loading?C.dim:G.blue,
              color:"#fff",border:"none",borderRadius:12,fontWeight:700,
              fontSize:15,cursor:loading?"wait":"pointer",
              boxShadow:loading?"none":"0 8px 24px rgba(26,108,245,0.35)",
              transition:"all .2s",letterSpacing:.3}}>
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
        <div style={{marginTop:14,padding:"12px 16px",background:"rgba(22,163,74,0.05)",
          borderRadius:12,border:"1px solid rgba(22,163,74,0.12)"}}>
          <div style={{color:"#6b8f72",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
            Demo kirish
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:12}}>
            <span style={{fontFamily:"monospace",color:"#4a7a52"}}>admin / admin123</span>
            <span style={{color:"#ca8a04",fontWeight:700,fontSize:11}}>Boshliq</span>
            <span style={{fontFamily:"monospace",color:"#4a7a52"}}>hodim1 / 1234</span>
            <span style={{color:"#16a34a",fontWeight:700,fontSize:11}}>Hodim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hodim ────────────────────────────────────────────────────────────────────
function Hodim({ user, records, setRecords, onLogout }) {
  const [step,setStep]=useState("mfy");
  const [mfy,setMfy]=useState(null);
  const [face,setFace]=useState(null);
  const [passport,setPassport]=useState(null);
  const [name,setName]=useState("");
  const [jshshir,setJshshir]=useState("");
  const [coords,setCoords]=useState(null);
  const [sending,setSending]=useState(false);
  const [search,setSearch]=useState("");
  const [toast,setToast]=useState(null);
  const [success,setSuccess]=useState(null);

  useEffect(()=>{
    navigator.geolocation?.getCurrentPosition(
      p=>setCoords({lat:p.coords.latitude.toFixed(6),lng:p.coords.longitude.toFixed(6)}),
      ()=>setCoords({lat:"40.6367",lng:"71.5567"})
    );
  },[]);

  const myToday=records.filter(r=>r.hodim===user.username&&fmtDate(new Date(r.timestamp))===todayStr()).length;
  const show=(msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3500); };

  const onPassport=(j,fullName,photo)=>{
    setJshshir(j); setPassport(photo);
    if(fullName&&!name.trim()) setName(fullName);
    show("✅ JShShIR aniqlandi!");
  };

  const submit = async () => {
    if(!face||!passport||!name.trim()||jshshir.length!==14){show("Barcha maydonlarni to'ldiring!","err");return;}
    setSending(true);
    try {
      const rec = {
        id: Date.now(), hodim: user.username, hodimName: user.name, mfy,
        fullName: name.trim(), jshshir, facePhoto: face, passportPhoto: passport,
        coords, timestamp: new Date().toISOString()
      };

      // 1) Firebase ga saqlash
      await addRecord(rec);

      // 2) Telegram ga yuborish
      try {
        await fetch("/api/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ record: rec, facePhoto: face, passportPhoto: passport }),
        });
      } catch {}

      setSuccess(rec);
      setFace(null); setPassport(null); setName(""); setJshshir(""); setStep("mfy");
    } catch (e) {
      show("Xatolik! Internet aloqasini tekshiring.", "err");
    }
    setSending(false);
  };

  const steps=[{ok:!!name.trim(),l:"FIO"},{ok:!!face,l:"Yuz"},{ok:!!passport,l:"Pasport"},{ok:jshshir.length===14,l:"JSHSHIR"}];
  const allOk=steps.every(s=>s.ok);
  const filtered=MFY_LIST.filter(m=>m.name.toLowerCase().includes(search.toLowerCase()));

  const srch={width:"100%",padding:"11px 14px 11px 40px",
    background:"#ffffff",border:`1px solid ${C.border}`,
    borderRadius:12,color:C.text,fontSize:14,outline:"none",boxSizing:"border-box",
    fontFamily:"inherit"};

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Segoe UI',system-ui,sans-serif",color:C.text}}>

      {/* Toast */}
      {toast&&<div style={{position:"fixed",top:14,left:"50%",transform:"translateX(-50%)",zIndex:999,
        background:toast.type==="err"?`linear-gradient(135deg,#c0392b,#e53e3e)`:G.green,
        color:"#fff",padding:"11px 22px",borderRadius:12,fontWeight:700,fontSize:14,
        boxShadow:"0 8px 32px rgba(0,0,0,0.6)",maxWidth:"88vw",textAlign:"center",
        animation:"fadeUp .3s",border:"1px solid rgba(255,255,255,0.1)"}}>
        {toast.msg}
      </div>}

      {/* Muvaffaqiyat modal */}
      {success&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1000,
        display:"flex",alignItems:"center",justifyContent:"center",padding:20,backdropFilter:"blur(16px)"}}>
        <div style={{background:C.card2,borderRadius:24,padding:"36px 26px",maxWidth:360,width:"100%",
          textAlign:"center",border:`1px solid rgba(13,185,109,0.25)`,animation:"fadeUp .4s",
          boxShadow:"0 0 80px rgba(13,185,109,0.08)"}}>
          <div style={{width:72,height:72,background:G.green,borderRadius:"50%",
            display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px",
            fontSize:32,boxShadow:"0 0 40px rgba(13,185,109,0.4)",animation:"popIn .5s"}}>✓</div>
          <h2 style={{color:C.green,fontSize:20,fontWeight:900,margin:"0 0 6px",letterSpacing:.3}}>
            Muvaffaqiyatli saqlandi
          </h2>
          <p style={{color:C.muted,fontSize:13,margin:"0 0 22px"}}>Ma'lumot tizimga va Telegramga yuborildi</p>
          <div style={{background:"rgba(13,185,109,0.06)",borderRadius:14,padding:"14px 18px",
            textAlign:"left",marginBottom:22,border:"1px solid rgba(13,185,109,0.12)"}}>
            <div style={{fontWeight:800,fontSize:17,color:C.text}}>{success.fullName}</div>
            <div style={{color:C.blue2,fontFamily:"monospace",fontSize:13,letterSpacing:2,marginTop:5}}>{success.jshshir}</div>
            <div style={{color:C.muted,fontSize:12,marginTop:4}}>{success.mfy?.name}</div>
          </div>
          <button onClick={()=>setSuccess(null)} style={{width:"100%",padding:14,
            background:G.green,color:"#fff",border:"none",borderRadius:12,
            fontWeight:800,fontSize:15,cursor:"pointer",
            boxShadow:"0 6px 20px rgba(13,185,109,0.3)"}}>
            ➕ Keyingi fuqaro
          </button>
        </div>
      </div>}

      {/* Header */}
      <div style={{background:"rgba(255,255,255,0.97)",backdropFilter:"blur(16px)",
        padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",
        borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:G.blue,borderRadius:10,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,
            boxShadow:`0 4px 12px rgba(26,108,245,0.4)`}}>🏛️</div>
          <div>
            <div style={{fontWeight:700,fontSize:14,color:C.text}}>{user.name}</div>
            <div style={{color:C.blue2,fontSize:11,fontWeight:600}}>
              Bugun: <b>{myToday}</b> ta  ·  Jami: <b>{records.filter(r=>r.hodim===user.username).length}</b>
            </div>
          </div>
        </div>
        <button onClick={onLogout} style={{padding:"6px 14px",background:"rgba(229,62,62,0.09)",
          color:"#fc8181",border:"1px solid rgba(229,62,62,0.2)",borderRadius:9,
          fontWeight:600,fontSize:12,cursor:"pointer"}}>Chiqish</button>
      </div>

      {/* ── MFY TANLASH ── */}
      {step==="mfy"&&<div style={{padding:"18px 16px"}}>
        <div style={{marginBottom:18}}>
          <div style={{color:C.gold2,fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>
            Qadam 1 / 2
          </div>
          <h2 style={{fontSize:20,fontWeight:900,margin:0,color:C.text}}>Mahalla tanlang</h2>
        </div>

        <div style={{position:"relative",marginBottom:12}}>
          <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:C.muted,fontSize:15}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="MFY nomini qidirish..." style={srch}/>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:"68vh",overflowY:"auto",paddingRight:2}}>
          {filtered.map(m=>{
            const cnt=records.filter(r=>r.mfy?.id===m.id&&r.hodim===user.username).length;
            return(
              <button key={m.id} onClick={()=>{setMfy(m);setStep("capture");setSearch("");}}
                style={{padding:"11px 14px",
                  background:cnt>0?"rgba(26,108,245,0.08)":"#ffffff",
                  border:cnt>0?`1px solid rgba(26,108,245,0.22)`:`1px solid ${C.border}`,
                  borderRadius:11,color:C.text,fontWeight:500,fontSize:13,cursor:"pointer",
                  textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center",
                  transition:"all .15s"}}>
                <span>
                  <span style={{color:C.dim,marginRight:8,fontSize:10,
                    background:"rgba(14,90,200,0.12)",padding:"1px 6px",borderRadius:5}}>{m.id}</span>
                  {m.name}
                </span>
                {cnt>0&&<span style={{background:"rgba(26,108,245,0.15)",color:C.blue2,
                  padding:"2px 9px",borderRadius:8,fontSize:11,fontWeight:700,flexShrink:0}}>{cnt} ta</span>}
              </button>
            );
          })}
        </div>
      </div>}

      {/* ── MA'LUMOT KIRITISH ── */}
      {step==="capture"&&<div style={{padding:"16px 16px 32px"}}>
        <button onClick={()=>setStep("mfy")}
          style={{background:"none",border:"none",color:C.blue2,fontWeight:600,
            fontSize:13,cursor:"pointer",padding:"0 0 14px",display:"flex",alignItems:"center",gap:5}}>
          ← Orqaga
        </button>

        {/* MFY badge */}
        <div style={{background:`linear-gradient(135deg,rgba(26,95,204,0.12),rgba(26,108,245,0.06))`,
          borderRadius:16,padding:"14px 16px",marginBottom:20,
          border:`1px solid rgba(26,108,245,0.2)`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{color:C.blue2,fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:1.5,marginBottom:3}}>
              Tanlangan mahalla
            </div>
            <div style={{fontSize:15,fontWeight:800,color:C.text}}>{mfy?.name}</div>
          </div>
          {coords&&<div style={{color:C.muted,fontSize:10,textAlign:"right"}}>
            📍{coords.lat}<br/>{coords.lng}
          </div>}
        </div>

        {/* Progress */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,marginBottom:22}}>
          {steps.map((s,i)=>(
            <div key={i}>
              <div style={{height:3,borderRadius:3,marginBottom:5,transition:"background .5s",
                background:s.ok?C.green:C.dim}}/>
              <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:.8,
                color:s.ok?C.green:C.muted}}>
                {s.ok?"✓ ":""}{s.l}
              </div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:18}}>
          {/* FIO */}
          <div>
            <label style={lbl}>F.I.O — To'liq ism sharif</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Fuqaroning to'liq ismi" style={inputSt(!!name.trim())}/>
          </div>

          {/* Yuz */}
          <div>
            <label style={lbl}>Yuz rasmi {face&&<span style={{color:C.green}}>— saqlandi ✓</span>}</label>
            <Camera onCapture={setFace}/>
          </div>

          {/* Skaner */}
          <div>
            <label style={lbl}>Hujjat skaneri {passport&&<span style={{color:C.green}}>— aniqlandi ✓</span>}</label>
            <p style={{color:C.muted,fontSize:11,margin:"3px 0 10px"}}>
              ID karta yoki zagranpassportni kameraga tuting
            </p>
            {passport?(
              <div style={{position:"relative"}}>
                <img src={passport} alt="" style={{width:"100%",borderRadius:13,border:`2px solid ${C.green}`}}/>
                <div style={{position:"absolute",top:10,right:10,background:C.green,color:"#fff",
                  borderRadius:20,padding:"4px 12px",fontSize:11,fontWeight:700}}>✓ Aniqlandi</div>
                <button onClick={()=>{setPassport(null);setJshshir("");}}
                  style={{marginTop:8,width:"100%",padding:10,background:"rgba(229,62,62,0.07)",
                    color:"#fc8181",border:"1px solid rgba(229,62,62,0.2)",borderRadius:10,
                    fontWeight:600,fontSize:13,cursor:"pointer"}}>🔄 Qayta skanerlash</button>
              </div>
            ):(<PassportScanner onFound={onPassport}/>)}
          </div>

          {/* JSHSHIR */}
          <div>
            <label style={lbl}>
              JShShIR — 14 ta raqam
              {jshshir.length===14&&<span style={{color:C.green,marginLeft:8,fontWeight:700}}>✓ To'g'ri</span>}
            </label>
            <input type="tel" inputMode="numeric" pattern="[0-9]*"
              value={jshshir}
              onChange={e=>{ const v=e.target.value.replace(/\D/g,""); if(v.length<=14) setJshshir(v); }}
              placeholder="50701065180016" maxLength={14}
              style={{...inputSt(jshshir.length===14),fontSize:19,letterSpacing:3,fontFamily:"monospace",fontWeight:700}}/>
            {jshshir&&jshshir.length<14&&(
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                <div style={{flex:1,height:3,background:C.dim,borderRadius:3,overflow:"hidden"}}>
                  <div style={{width:`${jshshir.length/14*100}%`,height:"100%",background:C.gold2,transition:"width .2s",borderRadius:3}}/>
                </div>
                <span style={{color:C.gold2,fontSize:11,fontWeight:700,flexShrink:0}}>{jshshir.length}/14</span>
              </div>
            )}
          </div>

          {/* Yuborish */}
          <button onClick={submit} disabled={sending||!allOk}
            style={{padding:15,border:"none",borderRadius:13,fontWeight:800,fontSize:15,
              cursor:!allOk||sending?"default":"pointer",color:"#fff",transition:"all .2s",
              background:allOk&&!sending?G.green:"#f4faf5",
              opacity:!allOk||sending?0.45:1,
              boxShadow:allOk&&!sending?"0 8px 28px rgba(13,185,109,0.3)":"none"}}>
            {sending
              ? <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <span style={{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",
                    borderRadius:"50%",animation:"spin .7s linear infinite",display:"inline-block"}}/>
                  Saqlanmoqda...
                </span>
              : "✓  Ma'lumotni yuborish"}
          </button>
        </div>
      </div>}
    </div>
  );
}

const lbl={color:C.muted,fontSize:11,fontWeight:700,display:"block",marginBottom:8,
  textTransform:"uppercase",letterSpacing:1.1};
const inputSt=ok=>({
  width:"100%",padding:"13px 16px",
  background:ok?"rgba(22,163,74,0.06)":"#ffffff",
  border:`1.5px solid ${ok?"rgba(22,163,74,0.4)":"rgba(22,163,74,0.2)"}`,
  borderRadius:12,color:C.text,fontSize:15,outline:"none",
  boxSizing:"border-box",fontFamily:"inherit",transition:"all .2s",
  boxShadow:"0 1px 4px rgba(0,0,0,0.05)",
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

  const hdr={background:"rgba(255,255,255,0.97)",backdropFilter:"blur(16px)",
    padding:"12px 16px",borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:50,
    boxShadow:"0 2px 12px rgba(22,163,74,0.08)"};
  const srch2={width:"100%",padding:"10px 14px 10px 38px",background:"#ffffff",
    border:`1px solid rgba(22,163,74,0.22)`,borderRadius:11,color:C.text,fontSize:13,
    outline:"none",boxSizing:"border-box",fontFamily:"inherit",
    boxShadow:"0 1px 4px rgba(0,0,0,0.05)"};
  const chip=(on)=>({padding:"6px 14px",borderRadius:9,fontWeight:700,
    fontSize:11,cursor:"pointer",letterSpacing:.3,
    background:on?G.blue:"#ffffff",color:on?"#fff":C.muted,
    border:on?`1px solid transparent`:`1px solid rgba(22,163,74,0.2)`});

  if(detail) return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Segoe UI',system-ui,sans-serif",color:C.text}}>
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
              <div style={{fontWeight:900,fontSize:19,color:C.text}}>{detail.fullName}</div>
              <div style={{color:C.blue2,fontFamily:"monospace",fontSize:14,letterSpacing:2,marginTop:5,
                background:"rgba(26,108,245,0.1)",padding:"3px 10px",borderRadius:8,display:"inline-block"}}>
                {detail.jshshir}
              </div>
            </div>
            <span style={{background:"rgba(212,149,26,0.12)",color:C.gold2,padding:"5px 12px",
              borderRadius:10,fontSize:11,fontWeight:700,border:`1px solid rgba(212,149,26,0.2)`,flexShrink:0}}>
              {detail.mfy?.name}
            </span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {[["📅",fmtDate(new Date(detail.timestamp))],["🕐",fmt(detail.timestamp)],
              ["👤",detail.hodimName],["📍",`${detail.coords?.lat?.slice(0,8)}, ${detail.coords?.lng?.slice(0,8)}`]
            ].map(([ic,v],k)=>(
              <div key={k} style={{padding:"8px 11px",background:"#f4faf5",
                borderRadius:9,fontSize:11,color:C.muted,border:`1px solid ${C.border}`}}>
                {ic} <span style={{color:C.text}}>{v}</span>
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
            boxShadow:"0 4px 12px rgba(212,149,26,0.35)"}}>🏛️</div>
          <div>
            <div style={{fontWeight:800,fontSize:13,color:C.text}}>Boshqaruv paneli</div>
            <div style={{color:C.gold2,fontSize:10,fontWeight:600}}>
              Jami: {records.length} · Bugun: {todayAll}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:7}}>
          <button onClick={exportCSV} style={{padding:"6px 12px",background:"rgba(13,185,109,0.08)",
            color:C.green,border:`1px solid rgba(13,185,109,0.2)`,borderRadius:9,
            fontWeight:700,fontSize:11,cursor:"pointer"}}>⬇ Excel</button>
          <button onClick={onLogout} style={{padding:"6px 12px",background:"rgba(229,62,62,0.08)",
            color:"#fc8181",border:"1px solid rgba(229,62,62,0.2)",borderRadius:9,
            fontWeight:600,fontSize:11,cursor:"pointer"}}>Chiqish</button>
        </div>
      </div>

      {/* Statistika */}
      <div style={{padding:"16px 16px 0",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        {[
          {icon:"📊",l:"Jami",v:records.length,c:C.blue2,bg:"rgba(26,108,245,0.08)"},
          {icon:"📅",l:"Bugun",v:todayAll,c:C.green,bg:"rgba(13,185,109,0.08)"},
          {icon:"🏘",l:"MFY",v:[...new Set(records.map(r=>r.mfy?.id))].filter(Boolean).length,c:C.gold2,bg:"rgba(212,149,26,0.08)"},
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
                  background:active?"rgba(26,108,245,0.1)":G.card,
                  border:active?`1px solid rgba(26,108,245,0.3)`:`1px solid ${C.border}`,
                  borderRadius:12,cursor:"pointer",textAlign:"left",transition:"all .15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                  <span style={{color:C.text,fontWeight:600,fontSize:13}}>{ud.name}</span>
                  <span style={{fontSize:11,color:C.muted}}>
                    Bugun <b style={{color:C.green}}>{today}</b>  ·  Jami <b style={{color:C.blue2}}>{total}</b>
                  </span>
                </div>
                <div style={{height:3,background:"rgba(14,90,200,0.1)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,transition:"width .6s",
                    width:`${Math.round(today/max*100)}%`,
                    background:today>0?"linear-gradient(90deg,#1a5fcc,#0db96d)":"transparent"}}/>
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
            style={{padding:"6px 11px",background:"rgba(229,62,62,0.08)",color:"#fc8181",
              border:"1px solid rgba(229,62,62,0.2)",borderRadius:9,fontWeight:700,fontSize:11,cursor:"pointer"}}>
            ✕ {USERS[hFilter]?.name}
          </button>}
        </div>
      </div>

      {/* Ro'yxat */}
      <div style={{padding:"10px 16px 36px"}}>
        <div style={{color:C.dim,fontSize:10,fontWeight:700,textTransform:"uppercase",
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
                  transition:"all .15s"}}>
                {r.facePhoto
                  ? <img src={r.facePhoto} alt="" style={{width:44,height:44,borderRadius:11,
                      objectFit:"cover",border:`1px solid ${C.border}`,flexShrink:0}}/>
                  : <div style={{width:44,height:44,borderRadius:11,background:C.dim,
                      flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:18}}>👤</div>
                }
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:13,color:C.text,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.fullName}</div>
                  <div style={{color:C.blue2,fontFamily:"monospace",fontSize:11,
                    letterSpacing:1,marginTop:3}}>{r.jshshir}</div>
                  <div style={{color:C.muted,fontSize:10,marginTop:2,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.mfy?.name} · {r.hodimName} · {fmt(r.timestamp)}
                  </div>
                </div>
                <span style={{color:C.dim,fontSize:16,flexShrink:0}}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,setUser]=useState(null);
  const [records,setRecords]=useState([]);

  // Firebase real-time
  useEffect(()=>{
    const unsub = listenRecords(setRecords);
    return ()=>unsub();
  },[]);

  if(!user) return <Login onLogin={setUser}/>;
  if(user.role==="hodim") return <Hodim user={user} records={records} setRecords={setRecords} onLogout={()=>setUser(null)}/>;
  return <Boshliq user={user} records={records} onLogout={()=>setUser(null)}/>;
}
