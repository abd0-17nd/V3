(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const canvas = $("board"), ctx = canvas.getContext("2d");
  const stage = $("canvasStage");
  const STORAGE_KEY = "own-whiteboard-v2";
  const LEGACY_KEY = "own-whiteboard-v1";
  let state = {version:2,name:"لوحتي الأولى",paper:"plain",items:[]};
  let tool="pen", color="#172033", size=4, fontSize=24, drawing=false, start=null, current=null;
  let undoStack=[],redoStack=[],dpr=1,view={x:0,y:0,scale:1},handStart=null,spaceHeld=false,pendingTextPoint=null;
  const validTools=new Set(["pen","marker","highlighter","eraser","line","arrow","rect","circle","text","image","hand"]);
  const shortcuts={p:"pen",m:"marker",h:"highlighter",e:"eraser",l:"line",a:"arrow",r:"rect",c:"circle",t:"text"};
  const imageCache = new Map();

  function cloneState(){return JSON.parse(JSON.stringify(state));}
  function snapshot(){return JSON.stringify(state);}
  function remember(){undoStack.push(snapshot());if(undoStack.length>100)undoStack.shift();redoStack=[];updateButtons();}
  function validItem(it){
    if(!it||typeof it.type!=="string")return false;
    if(["stroke","line","arrow","rect","circle"].includes(it.type))return Array.isArray(it.points)&&it.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
    if(it.type==="text")return typeof it.text==="string"&&Number.isFinite(it.x)&&Number.isFinite(it.y);
    if(it.type==="image")return typeof it.src==="string"&&Number.isFinite(it.x)&&Number.isFinite(it.y)&&Number.isFinite(it.w)&&Number.isFinite(it.h);
    return false;
  }
  function restore(raw,quiet=false){
    try{
      const parsed=JSON.parse(raw);
      if(!parsed||![1,2].includes(parsed.version)||!Array.isArray(parsed.items))throw new Error("invalid");
      state={version:2,name:String(parsed.name||"لوحتي").slice(0,80),paper:["plain","grid","dots","lines"].includes(parsed.paper)?parsed.paper:"plain",items:parsed.items.filter(validItem).map(it=>({...it,eraser:!!it.eraser}))};
      $("boardName").value=state.name;$("paper").value=state.paper;changed();
      if(!quiet)alert("تم استيراد اللوحة بنجاح.");
    }catch(e){alert("تعذر فتح الملف. تأكد أنه ملف Whiteboard صحيح.");}
  }
  function resize(){
    const rect=stage.getBoundingClientRect();dpr=Math.max(1,Math.min(3,window.devicePixelRatio||1));
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
    canvas.style.width=rect.width+"px";canvas.style.height=rect.height+"px";render();
  }
  function paperBackground(){
    const w=canvas.width/dpr,h=canvas.height/dpr;
    ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle="#ffffff";ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#e8eef5";ctx.fillStyle="#d8e1eb";ctx.lineWidth=1;
    const spacing=24;
    if(state.paper==="grid"){
      for(let x=((view.x%spacing)+spacing)%spacing;x<w;x+=spacing){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
      for(let y=((view.y%spacing)+spacing)%spacing;y<h;y+=spacing){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
    }else if(state.paper==="dots"){
      for(let x=((view.x%spacing)+spacing)%spacing;x<w;x+=spacing)for(let y=((view.y%spacing)+spacing)%spacing;y<h;y+=spacing){ctx.beginPath();ctx.arc(x,y,1.1,0,Math.PI*2);ctx.fill()}
    }else if(state.paper==="lines"){
      for(let y=28+((view.y%28)+28)%28;y<h;y+=28){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
    }
    ctx.restore();
  }
  function drawArrow(a,b){
    const head=Math.max(10,(size||4)*3),angle=Math.atan2(b.y-a.y,b.x-a.x);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
    ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(angle-Math.PI/6),b.y-head*Math.sin(angle-Math.PI/6));
    ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(angle+Math.PI/6),b.y-head*Math.sin(angle+Math.PI/6));ctx.stroke();
  }
  function drawItem(it){
    ctx.save();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.translate(view.x,view.y);ctx.scale(view.scale,view.scale);
    ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=it.color||"#172033";ctx.fillStyle=it.color||"#172033";
    ctx.lineWidth=it.width||4;
    if(it.type==="stroke"){
      if(!it.points.length){ctx.restore();return}
      ctx.globalCompositeOperation=it.eraser?"destination-out":"source-over";
      if(it.highlighter){ctx.globalAlpha=.28;ctx.lineWidth=(it.width||10)*2.5}
      const pts=it.points;ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
      if(pts.length===1){ctx.lineTo(pts[0].x+.1,pts[0].y+.1)}
      ctx.stroke();
    }else if(["line","arrow","rect","circle"].includes(it.type)){
      const a=it.points[0],b=it.points[it.points.length-1];if(!a||!b){ctx.restore();return}
      ctx.beginPath();
      if(it.type==="line"){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      if(it.type==="arrow"){drawArrow(a,b)}
      if(it.type==="rect"){ctx.rect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.stroke()}
      if(it.type==="circle"){const rx=(b.x-a.x)/2,ry=(b.y-a.y)/2;ctx.ellipse(a.x+rx,a.y+ry,Math.abs(rx),Math.abs(ry),0,0,Math.PI*2);ctx.stroke()}
    }else if(it.type==="text"){
      ctx.fillStyle=it.color||"#172033";ctx.font=`${it.fontSize||24}px system-ui, sans-serif`;ctx.textBaseline="top";
      String(it.text).split("\n").forEach((line,i)=>ctx.fillText(line,it.x,it.y+i*(it.fontSize||24)*1.35));
    }else if(it.type==="image"){
      let img=imageCache.get(it.src);
      if(!img){
        img=new Image();
        img.onload=()=>render();
        img.src=it.src;
        imageCache.set(it.src,img);
      }
      if(img.complete&&img.naturalWidth>0)ctx.drawImage(img,it.x,it.y,it.w,it.h);
    }
    ctx.restore();
  }
  function render(){
    if(!ctx)return;
    paperBackground();state.items.forEach(drawItem);
    if(drawing&&current&&["line","arrow","rect","circle"].includes(tool))drawItem({type:tool,points:[start,current],color,width:size});
    $("emptyHint").classList.toggle("hidden",state.items.length>0);
    $("strokeCount").textContent=`${state.items.length} عنصر`;
    $("zoomLabel").textContent=`${Math.round(view.scale*100)}%`;
    updateButtons();
  }
  let saveTimer;
  function saveLocal(){
    $("saveStatus").textContent="جارٍ الحفظ…";clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));$("saveStatus").textContent="تم الحفظ على الجهاز";}
      catch(e){$("saveStatus").textContent="الذاكرة ممتلئة";console.warn(e)}
    },200);
  }
  function changed(){render();saveLocal();}
  function updateButtons(){$("undoBtn").disabled=!undoStack.length;$("redoBtn").disabled=!redoStack.length;}
  function point(e){
    const r=canvas.getBoundingClientRect();
    return{x:(e.clientX-r.left-view.x)/view.scale,y:(e.clientY-r.top-view.y)/view.scale};
  }
  function setTool(next){
    if(!validTools.has(next))return;tool=next;stage.dataset.tool=tool;
    document.querySelectorAll("[data-tool]").forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
    if(tool==="image")$("imageFile").click();
  }
  function zoom(factor,anchorX,anchorY){
    const old=view.scale;const next=Math.max(.35,Math.min(3,old*factor));
    const rect=canvas.getBoundingClientRect(),ax=anchorX??rect.width/2,ay=anchorY??rect.height/2;
    view.x=ax-(ax-view.x)*(next/old);view.y=ay-(ay-view.y)*(next/old);view.scale=next;render();
  }
  document.querySelectorAll("[data-tool]").forEach(b=>b.addEventListener("click",()=>setTool(b.dataset.tool)));
  $("color").addEventListener("input",e=>color=e.target.value);
  $("size").addEventListener("input",e=>{size=Number(e.target.value);$("sizeValue").value=size});
  $("fontSize").addEventListener("change",e=>fontSize=Number(e.target.value));
  $("paper").addEventListener("change",e=>{remember();state.paper=e.target.value;changed()});
  $("boardName").addEventListener("input",e=>{state.name=e.target.value.slice(0,80);saveLocal()});
  $("zoomInBtn").addEventListener("click",()=>zoom(1.2));
  $("zoomOutBtn").addEventListener("click",()=>zoom(1/1.2));
  $("resetViewBtn").addEventListener("click",()=>{view={x:0,y:0,scale:1};render()});

  canvas.addEventListener("wheel",e=>{
    if(!e.ctrlKey)return;e.preventDefault();const r=canvas.getBoundingClientRect();zoom(e.deltaY<0?1.1:1/1.1,e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  canvas.addEventListener("pointerdown",e=>{
    e.preventDefault();canvas.setPointerCapture(e.pointerId);
    if(spaceHeld){toolBeforeSpace=tool;stage.dataset.tool="spacehand";handStart={clientX:e.clientX,clientY:e.clientY,x:view.x,y:view.y};drawing=true;return}
    const p=point(e);
    if(tool==="hand"){handStart={clientX:e.clientX,clientY:e.clientY,x:view.x,y:view.y};drawing=true;return}
    if(tool==="text"){pendingTextPoint=p;$("textValue").value="";$("textDialog").showModal();return}
    if(tool==="image"){pendingTextPoint=p;$("imageFile").click();return}
    remember();drawing=true;start=p;current=p;
    if(["pen","marker","highlighter","eraser"].includes(tool)){
      state.items.push({type:"stroke",points:[p],color:tool==="eraser"?"#ffffff":color,width:tool==="marker"?size*3:tool==="highlighter"?size*2.5:size,eraser:tool==="eraser",highlighter:tool==="highlighter"});
    }
    render();
  });
  let toolBeforeSpace="pen";
  canvas.addEventListener("pointermove",e=>{
    if(!drawing)return;
    if(handStart&&(tool==="hand"||spaceHeld||stage.dataset.tool==="spacehand")){
      view.x=handStart.x+(e.clientX-handStart.clientX);view.y=handStart.y+(e.clientY-handStart.clientY);render();return;
    }
    const p=point(e);current=p;
    if(["pen","marker","highlighter","eraser"].includes(tool)){const item=state.items[state.items.length-1];if(item&&item.type==="stroke")item.points.push(p)}
    render();
  });
  function finish(){
    if(!drawing)return;drawing=false;handStart=null;
    if(["line","arrow","rect","circle"].includes(tool)&&start&&current)state.items.push({type:tool,points:[start,current],color,width:size});
    start=null;current=null;
    if(spaceHeld)stage.dataset.tool="spacehand";else stage.dataset.tool=tool;
    changed();
  }
  canvas.addEventListener("pointerup",finish);canvas.addEventListener("pointercancel",finish);
  $("addTextBtn").addEventListener("click",e=>{
    const text=$("textValue").value.trim();if(!text||!pendingTextPoint)return;
    remember();state.items.push({type:"text",text,x:pendingTextPoint.x,y:pendingTextPoint.y,color,fontSize});pendingTextPoint=null;changed();
  });
  $("imageFile").addEventListener("change",async e=>{
    const file=e.target.files&&e.target.files[0];if(!file){return}
    if(!file.type.startsWith("image/")){alert("اختَر ملف صورة.");e.target.value="";return}
    if(file.size>8*1024*1024){alert("الصورة أكبر من 8 ميجابايت. اختَر صورة أصغر حتى لا تمتلئ مساحة الحفظ.");e.target.value="";return}
    try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});
      const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=data});
      const max=360,scale=Math.min(1,max/Math.max(img.width,img.height));
      const p=pendingTextPoint||{x:(canvas.clientWidth/2-view.x)/view.scale,y:(canvas.clientHeight/2-view.y)/view.scale};
      remember();state.items.push({type:"image",src:data,x:p.x,y:p.y,w:img.width*scale,h:img.height*scale});pendingTextPoint=null;changed();
    }catch(err){alert("تعذرت قراءة الصورة.");console.warn(err)}
    finally{e.target.value="";if(tool==="image")setTool("pen")}
  });
  $("undoBtn").addEventListener("click",()=>{if(!undoStack.length)return;redoStack.push(snapshot());const prev=undoStack.pop();restore(prev,true);updateButtons()});
  $("redoBtn").addEventListener("click",()=>{if(!redoStack.length)return;undoStack.push(snapshot());const next=redoStack.pop();restore(next,true);updateButtons()});
  $("clearBtn").addEventListener("click",()=>$("confirmDialog").showModal());
  $("confirmClearBtn").addEventListener("click",()=>{remember();state.items=[];changed()});
  $("newBoardBtn").addEventListener("click",()=>{
    if(state.items.length&&!confirm("هل تريد إنشاء لوحة جديدة؟ صدّر اللوحة الحالية أولًا إذا كنت تريد الاحتفاظ بها."))return;
    remember();state={version:2,name:"لوحة جديدة",paper:"plain",items:[]};$("boardName").value=state.name;$("paper").value=state.paper;view={x:0,y:0,scale:1};changed();
  });
  function safeName(){return(state.name||"whiteboard").replace(/[^\p{L}\p{N}_-]+/gu,"_").slice(0,50)||"whiteboard"}
  $("exportBtn").addEventListener("click",()=>{
    const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=safeName()+".wboard";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  $("importBtn").addEventListener("click",()=>$("importFile").click());
  $("importFile").addEventListener("change",async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    try{const raw=await file.text();const parsed=JSON.parse(raw);if(!parsed||![1,2].includes(parsed.version)||!Array.isArray(parsed.items))throw new Error("bad");if(!confirm("سيتم استبدال اللوحة الحالية بمحتوى الملف. هل تريد المتابعة؟"))return;remember();restore(raw,true);undoStack=[];redoStack=[];alert("تم استيراد اللوحة بنجاح.");}
    catch(err){alert("الملف غير صالح أو ليس ملف Whiteboard مدعومًا.")}
    finally{e.target.value=""}
  });
  $("pngBtn").addEventListener("click",()=>{
    try{
      const w=canvas.width,h=canvas.height;
      const out=document.createElement("canvas");out.width=w;out.height=h;const o=out.getContext("2d");
      o.fillStyle="#ffffff";o.fillRect(0,0,w,h);o.drawImage(canvas,0,0);
      out.toBlob(blob=>{if(!blob){alert("تعذر تصدير الصورة.");return}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=safeName()+".png";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}, "image/png");
    }catch(err){alert("تعذر تصدير الصورة.");}
  });
  window.addEventListener("keydown",e=>{
    const tag=(document.activeElement&&document.activeElement.tagName||"").toLowerCase();
    if(["input","textarea","select"].includes(tag)||$("textDialog").open)return;
    if(e.code==="Space"){spaceHeld=true;stage.dataset.tool="spacehand";e.preventDefault();return}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();$("undoBtn").click();return}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("redoBtn").click();return}
    if(e.key==="?"||e.key==="/"){$("helpDialog").showModal();return}
    const next=shortcuts[e.key.toLowerCase()];if(next)setTool(next);
  });
  window.addEventListener("keyup",e=>{if(e.code==="Space"){spaceHeld=false;stage.dataset.tool=tool}});
  window.addEventListener("blur",()=>{spaceHeld=false;stage.dataset.tool=tool});
  try{
    let saved=localStorage.getItem(STORAGE_KEY);
    if(!saved)saved=localStorage.getItem(LEGACY_KEY);
    if(saved){const p=JSON.parse(saved);if(p&&[1,2].includes(p.version)&&Array.isArray(p.items)){state={version:2,name:p.name||"لوحتي الأولى",paper:p.paper||"plain",items:p.items.filter(validItem)};$("boardName").value=state.name;$("paper").value=state.paper}}
  }catch(e){console.warn("Local save could not be loaded",e)}
  if("serviceWorker" in navigator&&(location.protocol==="https:"||location.hostname==="localhost")){
    window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Offline cache unavailable",err)));
  }
  new ResizeObserver(resize).observe(stage);resize();render();
})();