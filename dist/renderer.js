/* The mansion is drawn entirely with canvas. No image downloads needed. */
(() => {
  'use strict';
  const INK = '#3d4938';
  const shades = new Map();
  const shade = (hex, amt) => {
    if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return '#8b9476';
    const key = hex + ':' + amt;
    if (shades.has(key)) return shades.get(key);
    const color = '#' + hex.slice(1).match(/../g).map(v => Math.max(0, Math.min(255, parseInt(v, 16) + amt)).toString(16).padStart(2, '0')).join('');
    shades.set(key, color); return color;
  };
  class MansionRenderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.world = world;
      // Each floor keeps its static scenery in painter order between visits.
      this.furniture = (world.furniture || []).filter(item => item.type !== 'rug').map(item => ({ item, depth: item.x + item.y + (item.w || 1) / 2 + (item.h || 1) / 2 })).sort((a, b) => a.depth - b.depth);
      this.rugs = (world.furniture || []).filter(item => item.type === 'rug');
      this.frontPlanters = [{ type: 'planter', x: .4, y: 21, w: .65, h: .65 }, { type: 'planter', x: 28.8, y: 21, w: .65, h: .65 }];
      this.architectureCache = null;
      this.spriteCache = new Map();
      this.spritePixels = 0;
      this.spriteUnit = null;
      this.cacheStats = { architectureBuilds: 0, architectureHits: 0, spriteBuilds: 0, spriteHits: 0 };
      this.camera = { zoom: 1.45, overview: false, previousZoom: 1.45, initialized: false, lastTime: null };
      this.endingShot = null;
      this.tvVideo = null;
      this.lastPlayer = world.start || { x: 15, y: 17 };
      this.resize();
    }
    setFloor(player) {
      this.endingShot = null;
      this.furniture = (this.world.furniture || []).filter(item => item.type !== 'rug').map(item => ({ item, depth: item.x + item.y + (item.w || 1) / 2 + (item.h || 1) / 2 })).sort((a, b) => a.depth - b.depth);
      this.rugs = (this.world.furniture || []).filter(item => item.type === 'rug');
      // Release the previous floor's surfaces rather than retaining a second
      // mansion worth of textures. The existing 8-million-pixel bound holds.
      if (this.architectureCache) { this.architectureCache.canvas.width = 0; this.architectureCache.canvas.height = 0; }
      this.architectureCache = null;
      this.clearSprites();
      this.backdropGradient = null;
      this.camera.initialized = false;
      this.camera.lastTime = null;
      this.updateCamera(player || this.lastPlayer, 0, true);
    }
    setTVVideo(video) {
      this.tvVideo = video || null;
      return !!this.tvVideo;
    }
    endingPose(state,time) {
      const ending=state.ending;
      if(!this.endingShot||this.endingShot.ending!==ending) {
        const sofa=this.world.furniture.find(item=>item.type==='sofa'&&item.room===this.world.home?.room&&item.orientation==='north');
        const television=this.world.furniture.find(item=>(item.type==='television'||item.type==='tv')&&item.room===this.world.home?.room);
        const collected=state.haulCounts?(this.world.snackKinds||[]).filter(kind=>state.haulCounts[kind.id]>0):(this.world.snacks||[]).filter(snack=>state.found?.has(snack.id));
        const icons=[...new Set(collected.map(snack=>snack.icon).filter(Boolean))];
        this.endingShot={ending,sofa,television,icons:icons.length?icons:['🍿'],startedAt:time,fromPlayer:{x:state.player.x,y:state.player.y},fromView:{unit:this.unit,ox:this.ox,oy:this.oy}};
      }
      const shot=this.endingShot,elapsed=Math.max(0,Number(ending.elapsed)||0);
      const seat=this.world.home?.seat||{x:shot.sofa?shot.sofa.x+shot.sofa.w*.4:this.world.home.x,y:shot.sofa?shot.sofa.y+.4:this.world.home.y};
      const progress=Math.min(1,elapsed/1.3),walk=progress*progress*(3-2*progress);
      const pose={...state.player,x:shot.fromPlayer.x+(seat.x-shot.fromPlayer.x)*walk,y:shot.fromPlayer.y+(seat.y-shot.fromPlayer.y)*walk,facing:1,moving:progress<1,cinematic:true};
      const sofa=shot.sofa||{x:seat.x-1.32,y:seat.y-.4,w:3.3,h:1.25},tv=shot.television||this.world.home.television||{x:seat.x+1.73,y:seat.y-5.8,w:1.65,h:.65};
      const minX=sofa.x-sofa.y-sofa.h-.5,maxX=tv.x+tv.w-tv.y+.45;
      const minY=(tv.x+tv.y)*.5-2.3,maxY=(sofa.x+sofa.w+sofa.y+sofa.h)*.5+.3;
      const targetUnit=Math.min(92,Math.max(12,(this.width-36)/(maxX-minX)),Math.max(12,(this.height-210)/(maxY-minY)));
      const wide={unit:targetUnit,ox:this.width*.5-(minX+maxX)*.5*targetUnit,oy:this.height*.5-25-(minY+maxY)*.5*targetUnit};
      let from=shot.fromView,to=wide,progressCamera=Math.min(1,elapsed/2.2),shotName='wide';
      if(this.width<=700&&this.height>this.width) {
        const centerY=Math.min(this.height*.48,this.height-210);
        const tvUnit=Math.min(100,this.width/4.3),tvCenterX=tv.x+tv.w*.5-tv.y-.32,tvCenterY=(tv.x+tv.w*.5+tv.y+.32)*.5-1.175;
        const television={unit:tvUnit,ox:this.width*.5-tvCenterX*tvUnit,oy:centerY-tvCenterY*tvUnit};
        const eatUnit=Math.min(80,this.width/5.5),eating={unit:eatUnit,ox:this.width*.5-(seat.x-seat.y)*eatUnit,oy:centerY-((seat.x+seat.y)*.5-1.55)*eatUnit};
        if(elapsed<1.5){progressCamera=elapsed/1.5;}
        else if(elapsed<2.2){from=wide;to=television;progressCamera=(elapsed-1.5)/.7;shotName='tv';}
        else if(elapsed<=4){from=to=television;progressCamera=1;shotName='tv';}
        else if(elapsed<5.2){from=television;to=eating;progressCamera=(elapsed-4)/1.2;shotName='eating';}
        else if(elapsed<8){from=to=eating;progressCamera=1;shotName='eating';}
        else if(elapsed<9){from=eating;to=wide;progressCamera=elapsed-8;}
        else{from=to=wide;progressCamera=1;}
      }
      const ease=1-Math.pow(1-Math.max(0,Math.min(1,progressCamera)),3);
      shot.targetUnit=to.unit;shot.cameraMoving=progressCamera<1;shot.shotName=shotName;
      this.unit=from.unit+(to.unit-from.unit)*ease;
      this.ox=from.ox+(to.ox-from.ox)*ease;
      this.oy=from.oy+(to.oy-from.oy)*ease;
      if(progressCamera>=1)this.unit=to.unit;
      this.lastPlayer=pose;this.camera.lastTime=time;this.camera.initialized=true;
      return pose;
    }
    floorData() {
      const level = Number(this.world.level) || 0;
      return this.world.floors?.find(floor => Number(floor.id) === level) || this.world.floors?.[level];
    }
    resize() {
      const b = this.canvas.getBoundingClientRect();
      this.width = b.width || 1000;
      this.height = b.height || 620;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      this.backdropGradient = null;
      if (this.architectureCache) this.architectureCache.unit = null;
      this.clearSprites();
      this.fitUnit = Math.max(3, Math.min((this.width - 72) / 52, (this.height - 148) / 28.3));
      // Portrait play stays at room scale; the estate overview is a separate view.
      this.playUnit = this.width < 800 || this.height < 550
        ? Math.max(this.fitUnit, Math.min(this.width / 28, this.height / 18))
        : this.fitUnit;
      this.updateCamera(this.lastPlayer, 0, true);
    }
    setZoom(value) {
      if (!Number.isFinite(value)) return this.camera.zoom;
      this.camera.overview = false;
      this.camera.zoom = Math.max(.75, Math.min(2.6, value));
      return this.camera.zoom;
    }
    zoomBy(factor) {
      if (!Number.isFinite(factor) || factor <= 0) return this.camera.zoom;
      return this.setZoom(this.camera.zoom * factor);
    }
    getZoom() { return this.camera.overview ? 1 : this.camera.zoom; }
    resetView() {
      this.camera.overview = false;
      this.camera.zoom = 1.45;
      return this.camera.zoom;
    }
    toggleOverview() {
      this.camera.overview = !this.camera.overview;
      if (this.camera.overview) this.camera.previousZoom = this.camera.zoom;
      else this.camera.zoom = this.camera.previousZoom || 1.45;
      return this.camera.overview;
    }
    updateCamera(player, time, snap = false) {
      this.lastPlayer = player || this.lastPlayer;
      const camera = this.camera;
      const delta = camera.lastTime == null ? 16 : Math.max(0, Math.min(100, time - camera.lastTime));
      const blend = snap || !camera.initialized ? 1 : 1 - Math.exp(-delta / 150);
      const targetUnit = camera.overview ? this.fitUnit : this.playUnit * camera.zoom;
      this.unit = (this.unit || targetUnit) + (targetUnit - (this.unit || targetUnit)) * blend;
      if (Math.abs(this.unit - targetUnit) < .005) this.unit = targetUnit;
      const u = this.unit, p = this.lastPlayer;
      let targetX, targetY;
      if (camera.overview) {
        targetX = this.width / 2 - 4 * u;
        targetY = this.height / 2 - 12.1 * u;
      } else {
        targetX = this.width * .5 - (p.x - p.y) * u;
        targetY = this.height * .54 - (p.x + p.y) * u * .5;
        const origin = (desired, size, low, high, margin) => high - low <= size - margin * 2
          ? (size - low - high) / 2
          : Math.max(size - margin - high, Math.min(margin - low, desired));
        targetX = origin(targetX, this.width, -22.8 * u, 30.8 * u, Math.min(64, this.width * .08));
        targetY = origin(targetY, this.height, -2.4 * u, 26.8 * u, Math.min(80, this.height * .09));
      }
      this.ox = (this.ox ?? targetX) + (targetX - (this.ox ?? targetX)) * blend;
      this.oy = (this.oy ?? targetY) + (targetY - (this.oy ?? targetY)) * blend;
      camera.initialized = true;
      camera.lastTime = time;
    }
    worldToScreen(x, y, z = 0) {
      return { x: this.ox + (x - y) * this.unit, y: this.oy + (x + y) * this.unit * .5 - z * this.unit };
    }
    screenToWorld(clientX, clientY) {
      const b = this.canvas.getBoundingClientRect();
      const a = (clientX - b.left - this.ox) / this.unit;
      const c = (clientY - b.top - this.oy) / this.unit;
      return { x: c + a / 2, y: c - a / 2 };
    }
    createCacheCanvas(width, height) {
      if (this.cacheUnsupported) return null;
      let canvas;
      if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
      else {
        const doc = this.canvas.ownerDocument || (typeof document !== 'undefined' ? document : null);
        if (!doc?.createElement) { this.cacheUnsupported = true; return null; }
        canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (!context) { this.cacheUnsupported = true; return null; }
      return { canvas, context };
    }
    clearSprites() {
      if (!this.spriteCache) return;
      for (const sprite of this.spriteCache.values()) if (sprite) { sprite.canvas.width = 0; sprite.canvas.height = 0; }
      this.spriteCache.clear(); this.spritePixels = 0; this.spriteUnit = null;
    }
    cacheReady() {
      if(this.endingShot?.cameraMoving)return false;
      const target = this.endingShot ? this.endingShot.targetUnit : this.camera.overview ? this.fitUnit : this.playUnit * this.camera.zoom;
      return Math.abs(this.unit - target) < .000001;
    }
    getPerformanceStats() {
      return { ...this.cacheStats, cachedPixels: this.spritePixels + (this.architectureCache ? this.architectureCache.canvas.width * this.architectureCache.canvas.height : 0), maximumCachedPixels: 8000000 };
    }
    drawBackdrop() {
      const c = this.ctx;
      if (!this.backdropGradient) {
        this.backdropGradient = c.createLinearGradient(0, 0, this.width * .5, this.height);
        const upper = Number(this.world.level) === 1,wing=Number(this.world.level)===2,midnight=Number(this.world.level)===3;
        this.backdropGradient.addColorStop(0, midnight?'#283a52':upper ? '#b4abc4' : wing?'#dce8d4':'#dbe2cd'); this.backdropGradient.addColorStop(.55, midnight?'#536980':upper ? '#9697b3' : '#bec9ad'); this.backdropGradient.addColorStop(1, midnight?'#8faaa9':upper ? '#7f91a2' : '#a8b797');
      }
      c.fillStyle = this.backdropGradient; c.fillRect(0, 0, this.width, this.height);
    }
    drawArchitectureCached() {
      // A viewport-sized backing store plus overscan follows small camera pans.
      // Zoom transitions use vectors until settled instead of rebuilding each tick.
      if (!this.cacheReady() || this.cacheUnsupported) { this.drawArchitecture(); return; }
      const margin = 128, logicalWidth = this.width + margin * 2, logicalHeight = this.height + margin * 2;
      const ratio = Math.min(this.dpr, 1.5, Math.sqrt(6000000 / (logicalWidth * logicalHeight)));
      const pixelWidth = Math.max(1, Math.floor(logicalWidth * ratio)), pixelHeight = Math.max(1, Math.floor(logicalHeight * ratio));
      let cache = this.architectureCache;
      const dx = cache ? this.ox - cache.ox : 0, dy = cache ? this.oy - cache.oy : 0;
      const valid = cache && cache.unit === this.unit && cache.width === this.width && cache.height === this.height && cache.ratio === ratio && Math.abs(dx) < margin - 2 && Math.abs(dy) < margin - 2;
      if (!valid) {
        if (!cache) {
          const surface = this.createCacheCanvas(pixelWidth, pixelHeight);
          if (!surface) { this.drawArchitecture(); return; }
          cache = this.architectureCache = { ...surface };
        }
        if (cache.canvas.width !== pixelWidth || cache.canvas.height !== pixelHeight) { cache.canvas.width = pixelWidth; cache.canvas.height = pixelHeight; }
        Object.assign(cache, { ox: this.ox, oy: this.oy, unit: this.unit, width: this.width, height: this.height, ratio });
        const context = this.ctx, ox = this.ox, oy = this.oy;
        this.ctx = cache.context; this.ox += margin; this.oy += margin;
        try {
          this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.ctx.clearRect(0, 0, pixelWidth / ratio, pixelHeight / ratio); this.ctx.lineJoin = 'round'; this.ctx.lineCap = 'round';
          this.drawArchitecture();
        } finally { this.ctx = context; this.ox = ox; this.oy = oy; }
        this.cacheStats.architectureBuilds++;
      } else this.cacheStats.architectureHits++;
      this.ctx.drawImage(cache.canvas, this.ox - cache.ox - margin, this.oy - cache.oy - margin, cache.canvas.width / ratio, cache.canvas.height / ratio);
    }
    drawFurnitureCached(item) {
      // Conservative projected bounds include tall foliage and lamp glow. Fully
      // offscreen furniture needs neither vector drawing nor a cached texture.
      const u = this.unit, sx = this.ox + (item.x - item.y) * u, sy = this.oy + (item.x + item.y) * u * .5;
      if (sx + (item.w + 1.6) * u + 4 < 0 || sx - (item.h + 1.6) * u - 4 > this.width || sy + ((item.w + item.h) * .5 + .5) * u + 4 < 0 || sy - 3.7 * u - 4 > this.height) return;
      if (!this.cacheReady() || this.cacheUnsupported) { this.drawFurniture(item); return; }
      if (this.spriteUnit !== this.unit) { this.clearSprites(); this.spriteUnit = this.unit; }
      let sprite = this.spriteCache.get(item);
      if (!this.spriteCache.has(item)) {
        const u = this.unit, padX = (item.type === 'lamp' ? 1.6 : .7) * u + 3, padY = .5 * u + 3;
        const maxZ = item.type === 'planter' ? 3.1 : item.type === 'lamp' ? 3.2 : 2.5;
        const left = (item.x - item.y - item.h) * u - padX, top = (item.x + item.y) * u * .5 - maxZ * u - padY;
        const right = (item.x + item.w - item.y) * u + padX, bottom = (item.x + item.y + item.w + item.h) * u * .5 + padY;
        const ratio = Math.min(this.dpr, 1.5), width = Math.ceil((right - left) * ratio), height = Math.ceil((bottom - top) * ratio);
        // Architecture gets at most 6 million pixels; furniture shares 2 million.
        if (width * height + this.spritePixels <= 2000000) {
          const surface = this.createCacheCanvas(width, height);
          if (surface) {
            sprite = { ...surface, left, top, ratio };
            const context = this.ctx, ox = this.ox, oy = this.oy;
            this.ctx = sprite.context; this.ox = -left; this.oy = -top;
            try { this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.ctx.lineJoin = 'round'; this.ctx.lineCap = 'round'; this.drawFurniture(item); }
            finally { this.ctx = context; this.ox = ox; this.oy = oy; }
            this.spritePixels += width * height; this.cacheStats.spriteBuilds++;
          }
        }
        this.spriteCache.set(item, sprite || null);
      } else if (sprite) this.cacheStats.spriteHits++;
      if (sprite) this.ctx.drawImage(sprite.canvas, this.ox + sprite.left, this.oy + sprite.top, sprite.canvas.width / sprite.ratio, sprite.canvas.height / sprite.ratio);
      else this.drawFurniture(item);
    }
    poly(points, fill, stroke = INK, width = 1) {
      const c = this.ctx;
      c.beginPath();
      points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
      c.closePath();
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
    }
    plane(x, y, w, h, z, color, stroke = INK, width = .8) {
      this.poly([this.worldToScreen(x,y,z), this.worldToScreen(x+w,y,z), this.worldToScreen(x+w,y+h,z), this.worldToScreen(x,y+h,z)],color,stroke,width);
    }
    box(x, y, w, h, z, color, base = 0, stroke = INK) {
      const p = (a,b,c) => this.worldToScreen(a,b,c);
      this.poly([p(x,y+h,base),p(x+w,y+h,base),p(x+w,y+h,z),p(x,y+h,z)],shade(color,-23),stroke,.9);
      this.poly([p(x+w,y,base),p(x+w,y+h,base),p(x+w,y+h,z),p(x+w,y,z)],shade(color,-40),stroke,.9);
      this.plane(x,y,w,h,z,color,stroke,.9);
    }
    line(x1,y1,z1,x2,y2,z2,color=INK,width=1) {
      const a=this.worldToScreen(x1,y1,z1),b=this.worldToScreen(x2,y2,z2),c=this.ctx;
      c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=color;c.lineWidth=width;c.stroke();
    }
    ellipse(x,y,z,rx,ry,color,stroke=null,width=1) {
      const p=this.worldToScreen(x,y,z),c=this.ctx;
      c.beginPath();c.ellipse(p.x,p.y,rx*this.unit,ry*this.unit,0,0,Math.PI*2);c.fillStyle=color;c.fill();
      if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
    }
    floor(room) {
      const {x,y,w,h}=room;
      const colors = {library:'#d7b98e',kitchen:'#cbd6ca',arcade:'#9ba1aa',lounge:'#d6a888',foyer:'#e5d7b5',conservatory:'#c7d0a6'};
      const base=colors[room.id] || room.floor || '#ddc6a7';
      this.plane(x,y,w,h,.02,base,INK,1);
      if(room.id==='kitchen'||room.id==='foyer'||room.id==='petKitchen'||room.id==='laundry') {
        for(let i=0;i<w;i++)for(let j=0;j<h;j++) {
          const cc=(i+j)%2?shade(base,9):shade(base,-9);
          this.plane(x+i,y+j,1,1,.025,cc,'rgba(61,73,56,.13)',.5);
        }
      } else if(room.id==='conservatory'||room.id==='terrace') {
        for(let i=0;i<w;i+=1)for(let j=0;j<h;j+=1) this.plane(x+i,y+j,1,1,.025,shade(base,((i*17+j*11)%3)*4),'#9da98a',.45);
      } else {
        for(let j=.2;j<h;j+=.65) this.line(x,y+j,.035,x+w,y+j,.035,shade(base,-20),.6);
        for(let j=0;j<h;j+=.65) for(let i=((Math.round(j*2)%2)?1.4:0);i<w;i+=2.4) this.line(x+i,y+j,.035,x+i,Math.min(y+j+.65,y+h),.035,shade(base,-20),.55);
      }
      this.plane(x+.18,y+.18,w-.36,h-.36,.04,null,'rgba(255,249,225,.52)',1.1);
    }
    shadow(x,y,w,h) { this.plane(x+.14,y+.18,w,h,.05,'rgba(38,46,31,.15)',null); }
    rug(x,y,w,h,color='#ce8b63') {
      this.plane(x,y,w,h,.055,color,shade(color,-25),.6);
      this.plane(x+.2,y+.2,w-.4,h-.4,.06,null,shade(color,35),1.4);
      this.plane(x+.35,y+.35,w-.7,h-.7,.06,null,shade(color,-17),.6);
      for(let i=.2;i<w;i+=.2){this.line(x+i,y-.12,.05,x+i,y,.05,'#e9d2a7',.8);this.line(x+i,y+h,.05,x+i,y+h+.12,.05,'#e9d2a7',.8);}
    }
    plant(x,y,w=.7,h=.7,size=1) {
      this.ellipse(x+w/2,y+h/2,.06,w*.68,h*.3,'rgba(39,55,32,.16)');
      this.box(x,y,w,h,.46,'#bd7b58');
      this.plane(x+.07,y+.07,w-.14,h-.14,.48,'#60513a');
      const p=this.worldToScreen(x+w/2,y+h/2,.45),c=this.ctx,u=this.unit*size;
      c.strokeStyle='#546742';c.lineWidth=1.8;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y-u*1.4);c.stroke();
      const leaves=[[-.32,-.75,-.5,-1.35],[.3,-.55,.7,-1.08],[-.2,-1.1,-.55,-1.65],[.18,-1.22,.56,-1.8],[0,-1.2,.05,-2.0]];
      leaves.forEach((a,i)=>{c.beginPath();c.moveTo(p.x,p.y+u*a[1]);c.quadraticCurveTo(p.x+u*a[2]*1.4,p.y+u*a[3]*.7,p.x+u*a[2],p.y+u*a[3]);c.quadraticCurveTo(p.x+u*a[0]*.1,p.y+u*a[3],p.x,p.y+u*a[1]);c.fillStyle=i%2?'#738952':'#526f43';c.fill();c.strokeStyle='#435a37';c.lineWidth=.6;c.stroke();});
    }
    drawFurniture(f) {
      const {x,y,w=1,h=1,type}=f;
      const color=f.color;
      if(type==='rug') {this.rug(x,y,w,h,color);return;}
      if(type==='planter'||type==='plant'){this.plant(x,y,w,h,Math.max(.65,Math.min(w,1.2)));return;}
      this.shadow(x,y,w,h);
      if(type==='washer') {
        this.box(x,y,w,h,1.45,color||'#cbd5d2');
        this.box(x+.06,y+h-.08,w-.12,.09,1.35,'#e2e8df',1.1);
        const c=this.ctx,p=this.worldToScreen(x+w*.5,y+h+.015,.65),u=this.unit;
        c.save();c.translate(p.x,p.y);c.transform(1,.5,0,1,0,0);
        c.fillStyle='#e9e9d9';c.strokeStyle='#748d92';c.lineWidth=Math.max(1,u*.07);c.beginPath();c.arc(0,0,u*.39,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='#547c8b';c.beginPath();c.arc(0,0,u*.3,0,Math.PI*2);c.fill();c.fillStyle='#b5ccd0';c.beginPath();c.arc(-u*.08,-u*.06,u*.13,0,Math.PI*2);c.fill();c.restore();
        for(let i=0;i<3;i++)this.ellipse(x+.27+i*.28,y+h+.02,1.22,.06,.055,i===0?'#d7a875':'#72929a');
        this.plane(x+.18,y+.18,w-.36,h-.4,1.46,'#e5e8d9',null);
      } else if(type==='towelShelf') {
        this.box(x,y,w,h,1.5,color||'#aa9378');
        for(let row=0;row<3;row++)for(let i=0;i<3;i++) {
          const z=.25+row*.42,xx=x+.12+i*(w-.22)/3;
          this.box(xx,y+h-.5,(w-.33)/3,.47,z+.26,['#d6bdad','#c3d0c3','#e4d9ba'][(i+row)%3],z);
          this.line(xx+.05,y+h+.01,z+.13,xx+(w-.33)/3-.05,y+h+.01,z+.13,'#f6efdb',.8);
        }
      } else if(type==='laundryBasket') {
        this.box(x,y,w,h,.7,color||'#bda17f');this.plane(x+.08,y+.08,w-.16,h-.16,.71,'#927e63');
        for(let i=.15;i<w;i+=.2)this.line(x+i,y+h+.01,.08,x+i,y+h+.01,.6,'#e1c9a3',.8);
        for(let j=.15;j<.6;j+=.16)this.line(x+.04,y+h+.01,j,x+w-.04,y+h+.01,j,'#e1c9a3',.8);
        for(const [a,b,cc]of[[.3,.3,'#d4c0d6'],[.6,.4,'#e8d6bb'],[.45,.65,'#9ab8c0']])this.ellipse(x+w*a,y+h*b,.78,.26,.15,cc,shade(cc,-22),.5);
      } else if(type==='clothesRack') {
        for(const xx of [x+.1,x+w-.1]){this.box(xx,y+.1,.08,h-.2,.12,'#9b8e7e');this.line(xx,y+h*.5,.1,xx,y+h*.5,2.05,'#8e7c6a',2);}
        this.line(x+.1,y+h*.5,2.05,x+w-.1,y+h*.5,2.05,'#b6a184',2.5);
        const colors=[color||'#bc8fa6','#d4bba1','#8da7ad','#b6a9c7'];
        for(let i=0;i<Math.floor(w/.5);i++) {
          const xx=x+.3+i*.48,z=1.85,yy=y+h*.5,cc=colors[i%colors.length];
          this.line(xx,yy,2.02,xx,yy,z,'#b8a27f',.8);
          this.poly([[xx-.18,yy,z-.08],[xx+.18,yy,z-.08],[xx+.23,yy,.65],[xx-.23,yy,.65]].map(([a,b,c])=>this.worldToScreen(a,b,c)),cc,shade(cc,-30),.8);
          this.line(xx,yy+.01,z-.2,xx,yy+.01,.7,shade(cc,18),.6);
        }
      } else if(type==='mirror') {
        this.box(x,y,w,h,.12,color||'#b99b75');
        const points=[[x,y+h*.5,.2],[x+w,y+h*.5,.2],[x+w,y+h*.5,2.2],[x,y+h*.5,2.2]].map(([a,b,c])=>this.worldToScreen(a,b,c));
        this.poly(points,'#a9c6cc',color||'#b99b75',Math.max(2,this.unit*.1));
        this.line(x+.15,y+h*.51,.55,x+w-.15,y+h*.51,1.45,'#e6e3d1',2);
        this.line(x+.15,y+h*.51,1.3,x+w-.15,y+h*.51,1.95,'#e6e3d1',1);
      } else if(type==='ottoman') {
        this.box(x+.1,y+.1,w-.2,h-.2,.3,'#6f655b');this.box(x,y,w,h,.65,color||'#b59ca0',.22);
        this.plane(x+.12,y+.1,w-.24,h-.2,.67,shade(color,8),shade(color,-14),.7);
        this.ellipse(x+w*.5,y+h*.5,.69,.06,.03,shade(color,-18));
      } else if(type==='trunk') {
        this.box(x,y,w,h,.75,color||'#a28b69');this.box(x-.03,y-.03,w+.06,h+.06,.88,shade(color,9),.68);
        for(const a of [.22,w-.32]){this.plane(x+a,y,.12,h,.9,'#d4ba86');this.box(x+a,y+h-.015,.12,.03,.73,'#c6aa74',.09);}
        this.box(x+w*.5-.1,y+h,.2,.035,.55,'#d9bd7f',.34);
      } else if(type==='recordCrate') {
        this.box(x,y,w,h,.62,color||'#aa8e68');this.plane(x+.08,y+.08,w-.16,h-.16,.63,'#706452');
        for(let i=0;i<7;i++){const yy=y+.1+i*(h-.2)/7;this.box(x+.12,yy,w-.24,.07,.91+(i%2)*.05,['#898d9e','#b28b7d','#c5b887'][i%3],.55);}
        this.box(x,y+h-.1,w,.1,.67,shade(color,12),.45);
      } else if(type==='rockingHorse') {
        const v=color||'#b59873';
        this.line(x+.1,y+h*.2,.12,x+w-.1,y+h*.2,.12,shade(v,-25),3);
        this.line(x+.1,y+h*.8,.12,x+w-.1,y+h*.8,.12,shade(v,-25),3);
        for(const xx of [x+.35,x+w-.35])this.box(xx,y+.25,.13,h-.5,.6,v,.12);
        this.box(x+.2,y+.15,w-.4,h-.3,1.0,v,.55);this.box(x+w-.5,y+.2,.24,h-.4,1.6,v,.8);
        this.box(x+w-.5,y+.2,.45,h-.4,1.65,shade(v,10),1.4);
        this.plane(x+.4,y+.13,.45,h-.26,1.02,'#a57571');
      } else if(type==='grill') {
        for(const xx of [x+.2,x+w-.3])for(const yy of [y+.2,y+h-.3])this.box(xx,yy,.1,.1,.85,'#5b6160');
        this.box(x,y,w,h,1.12,color||'#65767a',.7);this.plane(x+.1,y+.1,w-.2,h-.2,1.14,'#484c4c');
        for(let i=.2;i<w-.1;i+=.18)this.line(x+i,y+.12,1.16,x+i,y+h-.12,1.16,'#aab2a8',.8);
        for(const xx of [.4,.8,1.2])this.ellipse(x+xx,y+h+.02,.94,.07,.06,'#d4b787',INK,.5);
        this.line(x-.15,y+.1,1,x-.15,y+h-.1,1,'#c1b597',2);
      } else if(type==='stringLights') {
        const c=this.ctx,u=this.unit;
        for(const xx of [x,x+w])this.line(xx,y,0,xx,y,2.35,'#8c9f99',2);
        for(let i=0;i<12;i++) {
          const t=i/11,xx=x+w*t,z=2.35-Math.sin(t*Math.PI)*.38;
          if(i){const prev=(i-1)/11;this.line(x+w*prev,y,2.35-Math.sin(prev*Math.PI)*.38,xx,y,z,'#596e72',.7);}
          const p=this.worldToScreen(xx,y,z-.06);c.save();c.shadowColor='#ffe4ad';c.shadowBlur=u*.22;c.fillStyle='#ffe8b3';c.beginPath();c.arc(p.x,p.y,Math.max(1.4,u*.055),0,Math.PI*2);c.fill();c.restore();
        }
      } else if(type==='petBed') {
        const v=color||'#b9b391';
        this.box(x,y,w,h,.24,shade(v,-14));
        this.plane(x+.12,y+.12,w-.24,h-.24,.25,shade(v,20),shade(v,-8),.7);
        this.box(x,y,w,.2,.48,v,.24);this.box(x,y,.2,h,.48,v,.24);this.box(x+w-.2,y,.2,h,.48,v,.24);
        this.ellipse(x+w*.5,y+h*.54,.28,w*.23,h*.1,'#e7d3ae',shade(v,-16),.5);
        const p=this.worldToScreen(x+w*.5,y+h*.54,.3),c=this.ctx;c.save();c.font=`${Math.max(8,this.unit*.35)}px "Segoe UI Emoji",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('🐾',p.x,p.y);c.restore();
      } else if(type==='toyBox') {
        const v=color||'#c18c76';
        this.box(x,y,w,h,.58,v);this.plane(x+.1,y+.1,w-.2,h-.2,.59,'#916c58');
        for(const [a,b,vv]of[[.28,.3,'#e8bd62'],[.67,.55,'#8db8a4'],[.78,.25,'#dc9ca3']])this.ellipse(x+w*a,y+h*b,.64,.19,.13,vv,shade(v,-20),.6);
        this.box(x-.04,y+h-.12,w+.08,.16,.69,shade(v,17),.5);
        const p=this.worldToScreen(x+w*.5,y+h+.015,.28),c=this.ctx;c.save();c.font=`700 ${Math.max(6,this.unit*.2)}px "DM Sans",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillStyle='#f9eac7';c.fillText('TOYS',p.x,p.y);c.restore();
      } else if(type==='snackCart') {
        const v=color||'#b9ad7b';
        for(const a of [.12,w-.22])for(const b of [.12,h-.22])this.box(x+a,y+b,.1,.1,.9,shade(v,-30));
        this.box(x,y,w,h,.25,shade(v,-18),.15);this.box(x,y,w,h,1.05,v,.9);
        for(let i=0;i<3;i++){const xx=x+.18+i*Math.max(.23,(w-.55)/3);this.box(xx,y+.15,.2,Math.max(.2,h-.3),1.31,['#d29b73','#d6c37b','#9aaa7b'][i],1.05);}
        for(const a of [.12,w-.12])this.ellipse(x+a,y+h*.5,.08,.11,.07,'#625d4b');
      } else if(type==='sofa') {
        const v=color||'#7c936a',direction=f.orientation||'south';
        const sideways=direction==='east'||direction==='west',length=sideways?h:w,depth=sideways?w:h;
        // Build upholstery in seat-local coordinates: its open front is +y.
        // Rotate the parts within the existing collision footprint.
        const part=(a,b,pw,ph,z,fill,base=0)=>{
          if(direction==='north')this.box(x+w-a-pw,y+h-b-ph,pw,ph,z,fill,base);
          else if(direction==='east')this.box(x+b,y+h-a-pw,ph,pw,z,fill,base);
          else if(direction==='west')this.box(x+w-b-ph,y+a,ph,pw,z,fill,base);
          else this.box(x+a,y+b,pw,ph,z,fill,base);
        };
        const back=()=>part(0,0,length,.35,1.35,shade(v,-7));
        const arm=a=>part(a,0,.35,depth,1.0,shade(v,8));
        const nearBack=direction==='north'||direction==='west';
        const farArm=direction==='south'||direction==='west'?0:length-.35;
        this.box(x,y,w,h,.6,v);
        if(!nearBack)back();
        arm(farArm);
        const cw=(length-.8)/3;
        for(let i=0;i<3;i++)part(.4+i*cw,.4,cw-.06,depth-.5,.82,shade(v,18),.6);
        part(.5,.55,.5,.5,1.04,'#dfb56b',.8);
        part(length-1.05,.58,.5,.47,1.02,'#d68a6e',.8);
        arm(farArm===0?length-.35:0);
        // A near-side backrest must cover cushions across the whole couch.
        if(nearBack)back();
      } else if(type==='chair') {
        const v=color||'#bc8465';
        this.box(x+.1,y+.1,w-.2,h-.2,.55,v);
        this.box(x,y,w,.2,1.15,shade(v,-9));
        this.box(x,y,.15,h,.78,shade(v,5));
        this.box(x+w-.15,y,.15,h,.78,shade(v,5));
      } else if(type==='table'||type==='island'||type==='kitchenCounter'||type==='counter') {
        const k=type==='table',v=color||(k?'#a7835c':'#8ba28e'),z=k?.78:1.16;
        if(k){this.box(x+.15,y+.15,.15,.15,z-.1,'#6b674d');this.box(x+w-.3,y+h-.3,.15,.15,z-.1,'#6b674d');this.box(x+.15,y+h-.3,.15,.15,z-.1,'#6b674d');this.box(x+w-.3,y+.15,.15,.15,z-.1,'#6b674d');}
        else {this.box(x,y,w,h,z-.14,v);for(let i=1;i<w;i++)this.line(x+i,y+h,.3,x+i,y+h,z-.25,shade(v,-40),.7);}
        this.box(x-.05,y-.05,w+.1,h+.1,z,k?'#c8aa7d':'#e3dec5',z-.12);
        if(type==='kitchenCounter') {
          this.plane(x+.25,y+.15,Math.min(1.2,w-.4),Math.min(.7,h-.3),z+.02,'#8b9a8f');
          this.plane(x+.35,y+.25,Math.min(1,w-.6),Math.min(.5,h-.5),z+.03,'#5d716a');
          const p=this.worldToScreen(x+.8,y+.3,z);this.ctx.strokeStyle=INK;this.ctx.lineWidth=1.5;this.ctx.beginPath();this.ctx.arc(p.x,p.y-4,4,Math.PI,0);this.ctx.lineTo(p.x+4,p.y+1);this.ctx.stroke();
          if(w>3){this.plane(x+w-1.7,y+.2,1.3,h-.4,z+.025,'#4f5a4e');for(let i=0;i<2;i++)for(let j=0;j<2;j++)this.ellipse(x+w-1.4+i*.65,y+.38+j*.55,z+.03,.18,.095,'#68745b','#b4bca5',.7);}
        } else if(type==='island') {
          this.box(x+.25,y+.35,.9,.55,z+.06,'#b59162',z);
          this.ellipse(x+.65,y+.6,z+.09,.23,.13,'#e9b75f');
          this.line(x+.3,y+.5,z+.12,x+.9,y+.8,z+.12,'#f3d38c',1.3);
          this.box(x+w-.7,y+.25,.25,.25,z+.5,'#cbc18c',z);
        } else if(w>1.5) {
          this.ellipse(x+w*.6,y+h*.5,z+.03,.32,.16,'#eee3bd','#a58e66',.6);
          this.ellipse(x+w*.6,y+h*.5,z+.05,.2,.1,'#e3a450');
          this.box(x+.2,y+.2,.3,.3,z+.26,'#ece3c6',z);
        }
      } else if(type==='shelf'||type==='bookshelf') {
        const v=color||'#9a7956',z=2.0;
        this.box(x,y,w,h,z,v);
        for(let level=.28;level<z-.2;level+=.6) {
          this.poly([this.worldToScreen(x+.13,y+h+.01,level),this.worldToScreen(x+w-.13,y+h+.01,level),this.worldToScreen(x+w-.13,y+h+.01,level+.44),this.worldToScreen(x+.13,y+h+.01,level+.44)],'#645d40',null);
          const books=['#a6b288','#d4aa75','#a9b8b6','#b97760','#e3cfa3','#778b64'];
          for(let i=.2;i<w-.2;i+=.26){const zz=level+.3+(Math.sin(i*7)*.08);this.box(x+i,y+h-.14,.16,.17,zz,books[Math.floor((i*13+level*3)%books.length)],level);}
          this.line(x,y+h+.03,level,x+w,y+h+.03,level,'#d0b58b',1.8);
        }
        this.box(x-.08,y-.06,w+.16,h+.13,z+.12,'#ba976a',z);
      } else if(type==='fridge') {
        this.box(x,y,w,h,2.2,color||'#b9cbb3');
        this.line(x+.05,y+h+.015,1.45,x+w-.05,y+h+.015,1.45,'#5e7460',1.2);
        this.line(x+w-.22,y+h+.03,1.7,x+w-.22,y+h+.03,1.95,INK,2);
        this.line(x+w-.22,y+h+.03,.8,x+w-.22,y+h+.03,1.2,INK,2);
        this.plane(x+.3,y+.2,w-.6,h-.4,2.23,'#cfdbc7',null);
      } else if(type==='arcade') {
        const v=color||'#ac7d76';
        this.box(x,y,w,h,1.9,v);
        this.poly([this.worldToScreen(x+.12,y+h+.01,.85),this.worldToScreen(x+w-.12,y+h+.01,.85),this.worldToScreen(x+w-.12,y+h+.01,1.65),this.worldToScreen(x+.12,y+h+.01,1.65)],'#344b48',INK,.7);
        const pp=this.worldToScreen(x+w/2,y+h+.02,1.23),c=this.ctx;
        c.fillStyle='#dfb969';c.fillRect(pp.x-4,pp.y-2,8,3);c.fillStyle='#a7bc77';c.fillRect(pp.x-6,pp.y-6,3,3);c.fillRect(pp.x+3,pp.y-6,3,3);
        this.box(x-.05,y+h-.18,w+.1,.45,.8,shade(v,18),.64);
        this.ellipse(x+.35,y+h,.83,.08,.05,'#333e35');this.ellipse(x+w-.3,y+h,.83,.07,.045,'#dfb469');
        this.box(x-.1,y-.02,w+.2,.4,2.1,shade(v,12),1.9);
      } else if(type==='poolTable') {
        this.box(x+.25,y+.25,w-.5,h-.5,.82,'#876a4d');
        this.box(x,y,w,h,.99,color||'#9a7855',.82);
        this.plane(x+.2,y+.2,w-.4,h-.4,1.005,'#5f927c');
        for(const a of [[.22,.22],[w-.22,.22],[.22,h-.22],[w-.22,h-.22],[w/2,.18],[w/2,h-.18]])this.ellipse(x+a[0],y+a[1],1.02,.115,.065,'#354d3a');
        [['#ece6c6',.7,.7],['#d7a456',w*.6,h*.55],['#ca7c63',w*.7,h*.6],['#9ab1c2',w*.65,h*.4]].forEach(a=>this.ellipse(x+a[1],y+a[2],1.04,.085,.06,a[0],INK,.4));
        this.line(x+.5,y+h-.4,1.1,x+w-.5,y+.5,1.1,'#dbc397',1.6);
      } else if(type==='piano') {
        this.box(x,y,w,h,1.25,color||'#63634b');
        this.box(x,y,w,.28,1.7,'#53573f');
        this.plane(x+.2,y+h-.55,w-.4,.44,1.28,'#ece6ca');
        for(let i=.25;i<w-.3;i+=.2){this.line(x+i,y+h-.53,1.3,x+i,y+h-.12,1.3,'#6f7059',.6);if(Math.round(i*5)%3)this.plane(x+i,y+h-.55,.1,.23,1.32,'#3c4436',null);}
      } else if(type==='lamp') {
        this.ellipse(x+w/2,y+h/2,.08,.4,.18,'#8c8a61',INK,.6);
        this.line(x+w/2,y+h/2,.15,x+w/2,y+h/2,1.7,'#777d52',2);
        const p=this.worldToScreen(x+w/2,y+h/2,1.72),c=this.ctx,u=this.unit;
        c.beginPath();c.moveTo(p.x-u*.28,p.y-u*.5);c.lineTo(p.x+u*.28,p.y-u*.5);c.lineTo(p.x+u*.48,p.y+u*.07);c.quadraticCurveTo(p.x,p.y+u*.27,p.x-u*.48,p.y+u*.07);c.closePath();c.fillStyle='#f1d49c';c.fill();c.strokeStyle=INK;c.lineWidth=.8;c.stroke();
        const glow=c.createRadialGradient(p.x,p.y,0,p.x,p.y,u*1.4);glow.addColorStop(0,'rgba(255,218,123,.17)');glow.addColorStop(1,'rgba(255,218,123,0)');c.fillStyle=glow;c.fillRect(p.x-u*1.4,p.y-u*1.4,u*2.8,u*2.8);
      } else if(type==='television'||type==='tv') {
        this.box(x,y,w,h,.5,'#9c8056');
        this.box(x+.1,y+.1,w-.2,.2,1.8,'#4d594e',.5);
        const homeScreen=f.room===this.world.home?.room;
        this.poly([this.worldToScreen(x+.23,y+.32,.7),this.worldToScreen(x+w-.23,y+.32,.7),this.worldToScreen(x+w-.23,y+.32,1.65),this.worldToScreen(x+.23,y+.32,1.65)],homeScreen?'#26352f':'#819e89',INK,.5);
        this.line(x+.5,y+.33,1.05,x+w-.5,y+.33,1.45,homeScreen?'#40534a':'#afc4a1',homeScreen ? .8 : 2.2);
      } else if(type==='fountain') {
        this.ellipse(x+w/2,y+h/2,.06,w*.6,h*.31,'#9ca98c',INK,1);
        this.ellipse(x+w/2,y+h/2,.19,w*.5,h*.25,'#8caeaa',INK,.9);
        this.ellipse(x+w/2,y+h/2,.23,w*.38,h*.19,'#b9d3c1','#e2e9ce',1);
        this.box(x+w/2-.16,y+h/2-.16,.32,.32,1.4,'#c9c8a4');
        this.ellipse(x+w/2,y+h/2,1.38,.47,.23,'#d5d2af',INK,.7);
        this.ellipse(x+w/2,y+h/2,1.42,.35,.15,'#8ebbb6');
        this.line(x+w/2,y+h/2,1.45,x+w/2,y+h/2,1.85,'#e1ead2',1.3);
      } else if(type==='statue') {
        this.box(x,y,w,h,.55,'#b9b99b');
        this.box(x+.15,y+.15,w-.3,h-.3,.95,'#d8d3b5');
        this.ellipse(x+w/2,y+h/2,1.37,.27,.35,'#d7d5b4',INK,.7);
        this.ellipse(x+w/2,y+h/2,1.88,.23,.25,'#e5ddbb',INK,.7);
      } else this.box(x,y,w,h,.8,color||'#a29d7a');
    }
    televisionVideo(item,state,time) {
      if(!state.ending?.tvOn||Number(this.world.level)!==this.world.home?.level||item.room!==this.world.home?.room||(item.type!=='television'&&item.type!=='tv'))return;
      const c=this.ctx,{x,y,w}=item,u=this.unit;
      const tl=this.worldToScreen(x+.23,y+.32,1.65),tr=this.worldToScreen(x+w-.23,y+.32,1.65),bl=this.worldToScreen(x+.23,y+.32,.7),br=this.worldToScreen(x+w-.23,y+.32,.7);
      const center={x:(tl.x+br.x)*.5,y:(tl.y+br.y)*.5},pulse=.5+.5*Math.sin(time/740);
      c.save();
      const glow=c.createRadialGradient(center.x,center.y,0,center.x,center.y,u*2.15);
      glow.addColorStop(0,`rgba(169,225,199,${.13+pulse*.04})`);glow.addColorStop(1,'rgba(169,225,199,0)');
      c.fillStyle=glow;c.fillRect(center.x-u*2.15,center.y-u*2.15,u*4.3,u*4.3);
      this.ellipse(x+w*.5,y+1.45,.07,1.75,.55,`rgba(175,221,177,${.045+pulse*.025})`);
      c.beginPath();c.moveTo(tl.x,tl.y);c.lineTo(tr.x,tr.y);c.lineTo(br.x,br.y);c.lineTo(bl.x,bl.y);c.closePath();c.clip();
      // The screen lies in one isometric plane, so an affine rectangle maps
      // every video pixel to its exact front face without a second surface.
      c.transform(tr.x-tl.x,tr.y-tl.y,bl.x-tl.x,bl.y-tl.y,tl.x,tl.y);
      const video=this.tvVideo;let playing=false;
      if(video&&video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0) {
        try{c.drawImage(video,0,0,1,1);playing=true;}catch{/* A newly seeking video can briefly have no decoded frame. */}
      }
      if(!playing) {
        const standby=c.createLinearGradient(0,0,1,1);standby.addColorStop(0,'#9ad7bd');standby.addColorStop(.5,'#657fa4');standby.addColorStop(1,'#d7a86c');c.fillStyle=standby;c.fillRect(0,0,1,1);
        c.fillStyle='rgba(244,245,207,.6)';c.beginPath();c.arc(.5+Math.sin(time/1800)*.2,.48,.19,0,Math.PI*2);c.fill();
        c.fillStyle='#344f54';c.font='700 .12px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('SNACK TV',.5,.8);
      }
      c.fillStyle='rgba(22,48,39,.07)';for(let line=0;line<1;line+=.075)c.fillRect(0,line,1,.013);
      const power=Math.max(0,1-(Number(state.ending.elapsed)-2)*3.5);
      if(power>0){c.fillStyle=`rgba(220,255,229,${Math.min(.8,power*.6)})`;c.fillRect(0,0,1,1);}
      c.restore();
      this.ellipse(x+w-.13,y+.335,.59,.028,.025,'#b8e99a');
    }
    avatar(player,time) {
      const c=this.ctx,p=this.worldToScreen(player.x,player.y,.06),u=Math.max(12,this.unit),stride=player.moving?Math.sin(time/85):0,bob=player.moving?Math.abs(stride)*1.7:Math.sin(time/650)*.5;
      this.ellipse(player.x,player.y,.045,.61,.27,'rgba(222,237,148,.4)','#c6db86',1);
      this.ellipse(player.x,player.y,.05,.46,.19,'rgba(38,49,32,.22)');
      c.save();c.translate(p.x,p.y-bob);c.scale((player.facing<0?-1:1)*u/18,u/18);
      c.lineCap='round';c.lineJoin='round';
      c.strokeStyle='#354535';c.lineWidth=1.25;
      c.fillStyle='#414b39';c.beginPath();c.ellipse(-4-stride*1.8,-2+stride,4,2.5,-.2,0,Math.PI*2);c.ellipse(4+stride*1.8,-stride,4,2.5,-.2,0,Math.PI*2);c.fill();
      c.fillStyle='#66847b';c.beginPath();c.roundRect(-7,-17,13,14,4);c.fill();c.stroke();
      c.fillStyle='#d68c58';c.beginPath();c.roundRect(-6,-20,12,15,4);c.fill();c.stroke();
      c.strokeStyle='#e5b286';c.lineWidth=4;c.beginPath();c.moveTo(-6,-16);c.lineTo(-8-stride*1.4,-9+stride);c.moveTo(5,-16);c.lineTo(7+stride*1.4,-8-stride);c.stroke();
      c.fillStyle='#e3bb8e';c.beginPath();c.ellipse(0,-24,6.8,7.4,0,0,Math.PI*2);c.fill();c.strokeStyle='#425039';c.lineWidth=1;c.stroke();
      c.fillStyle='#687e43';c.beginPath();c.ellipse(-.8,-29,7.8,4.5,-.12,Math.PI,Math.PI*2);c.lineTo(7,-28);c.lineTo(9,-25);c.quadraticCurveTo(2,-23,-7,-26);c.closePath();c.fill();c.stroke();
      c.strokeStyle='#e9ce96';c.lineWidth=1;c.beginPath();c.moveTo(-1,-31);c.lineTo(-1,-27);c.stroke();
      c.fillStyle='#3a4934';c.beginPath();c.arc(3,-24,1,0,Math.PI*2);c.fill();
      c.restore();
    }
    seatedAvatar(player,state,time) {
      const c=this.ctx,shot=this.endingShot,u=Math.max(12,this.unit),elapsed=Math.max(0,Number(state.ending.elapsed)||0);
      const clock=Math.max(0,(time-shot.startedAt)/1000),settle=Math.max(0,Math.min(1,(elapsed-1.3)/.55));
      const bob=Math.sin(settle*Math.PI)*1.7,chew=.5+.5*Math.sin(clock*5.3),lift=elapsed>2.45?Math.pow(.5+.5*Math.sin(clock*2.2),2):0;
      const p=this.worldToScreen(player.x,player.y,.84);
      c.save();c.translate(p.x,p.y+bob);c.scale(u/18,u/18);c.lineCap='round';c.lineJoin='round';
      // Knees point towards the TV, resting above the north-facing cushions.
      c.strokeStyle='#66847b';c.lineWidth=6.2;c.beginPath();c.moveTo(-3,0);c.lineTo(7,0);c.lineTo(12,-5);c.moveTo(2,2);c.lineTo(11,2);c.lineTo(15,-3);c.stroke();
      c.strokeStyle='#414b39';c.lineWidth=4.5;c.beginPath();c.moveTo(11,-5);c.lineTo(15,-6);c.moveTo(14,-3);c.lineTo(18,-4);c.stroke();
      c.fillStyle='#d68c58';c.strokeStyle='#425039';c.lineWidth=1;c.beginPath();c.roundRect(-7,-17,14,18,4);c.fill();c.stroke();
      c.fillStyle='#e3bb8e';c.beginPath();c.ellipse(1,-23,6.7,7.3,0,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle='#687e43';c.beginPath();c.ellipse(0,-28,7.8,4.6,-.1,Math.PI,Math.PI*2);c.lineTo(8,-27);c.lineTo(10,-24);c.quadraticCurveTo(3,-22,-7,-25);c.closePath();c.fill();c.stroke();
      c.strokeStyle='#e9ce96';c.lineWidth=1;c.beginPath();c.moveTo(0,-30);c.lineTo(0,-26);c.stroke();
      c.fillStyle='#3a4934';c.beginPath();c.ellipse(4,-23,1,clock%4.8>4.6 ? .3 : 1,0,0,Math.PI*2);c.fill();
      c.strokeStyle='#916849';c.lineWidth=.8;c.beginPath();c.ellipse(5,-19.6,1.2+chew*.4,.45+chew*.4,0,0,Math.PI);c.stroke();
      // The bag and each bite use the kinds that were actually banked.
      c.fillStyle='#e8c58e';c.strokeStyle='#9e7a4e';c.lineWidth=.8;c.beginPath();c.roundRect(-12,-8,11,13,2);c.fill();c.stroke();
      c.fillStyle='#b38955';c.font='700 3.4px "DM Sans", sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('STASH',-6.5,1);
      c.strokeStyle='#e5b286';c.lineWidth=3.5;c.beginPath();c.moveTo(-6,-13);c.lineTo(-10,-7);c.moveTo(6,-13);c.lineTo(10,-8-lift*7);c.lineTo(8-lift*2,-5-lift*13);c.stroke();
      const icon=shot.icons[Math.floor(clock/4)%shot.icons.length];
      c.font='10px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(icon,8-lift*2,-5-lift*13);
      if(elapsed>2.45&&lift>.55) {
        c.fillStyle='#e8c789';for(let i=0;i<4;i++){const drop=(clock*1.8+i*.27)%1;c.globalAlpha=(1-drop)*.85;c.beginPath();c.arc(6+i*1.5,-16+drop*13,.55+(i%2)*.18,0,Math.PI*2);c.fill();}c.globalAlpha=1;
      }
      c.restore();
      // The near backrest covers the hips, keeping the player seated within
      // the sofa rather than appearing to float in front of its upholstery.
      const sofa=shot.sofa;
      if(sofa)this.box(sofa.x,sofa.y+sofa.h-.35,sofa.w,.35,1.35,shade(sofa.color||'#7c936a',-7));
    }
    guest(guest,state,time) {
      const c=this.ctx,p=this.worldToScreen(guest.x,guest.y,.06),u=Math.max(12,this.unit);
      if(p.x<-u*2||p.x>this.width+u*2||p.y<-u||p.y>this.height+u*3)return;
      const chatting=state.conversation?.guestId===guest.id;
      const chasing=!!guest.chasing&&!chatting,snacking=!!guest.snacking,bite=.5+.5*Math.sin(time/170);
      const stride=guest.moving&&!chatting?Math.sin(time/115+(guest.phase||0)):0;
      const bob=Math.abs(stride)*1.2,shirt=guest.color||'#b984a0',skin=guest.skin||'#d7ab84';
      this.ellipse(guest.x,guest.y,.045,.44,.19,'rgba(45,38,57,.2)');
      if(chatting)this.ellipse(guest.x,guest.y,.055,.68,.3,'rgba(235,177,214,.2)','#c88fb9',1);
      else if(chasing)this.ellipse(guest.x,guest.y,.055,.66,.29,'rgba(237,179,105,.17)','#c58e55',1.2);
      c.save();c.translate(p.x,p.y-bob);c.scale((guest.facing<0?-1:1)*u/18,u/18);c.lineCap='round';c.lineJoin='round';
      c.strokeStyle='#494157';c.lineWidth=1.1;
      c.fillStyle='#514d64';c.beginPath();c.ellipse(-4-stride,-1+stride,3.6,2.3,-.15,0,Math.PI*2);c.ellipse(4+stride,-stride,3.6,2.3,-.15,0,Math.PI*2);c.fill();
      c.fillStyle=shirt;c.beginPath();c.roundRect(-7,-19,14,16,4);c.fill();c.stroke();
      c.strokeStyle=skin;c.lineWidth=3.6;c.beginPath();c.moveTo(-6,-16);c.lineTo(-9-stride,-8+stride);
      c.moveTo(6,-16);c.lineTo(snacking?8:chatting?11:8+stride,snacking?-15-bite*6:chatting?-19+Math.sin(time/190)*1.5:-8-stride);c.stroke();
      c.strokeStyle='#494157';c.lineWidth=1;c.fillStyle=skin;c.beginPath();c.ellipse(0,-25,6.7,7.2,0,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle=guest.hair||'#67505d';c.beginPath();c.ellipse(-1,-29,7.2,4.8,-.15,Math.PI,Math.PI*2);c.lineTo(6,-25);c.lineTo(2,-28);c.lineTo(-5,-25);c.closePath();c.fill();
      c.fillStyle='#494157';c.beginPath();c.arc(2.6,-25,1,0,Math.PI*2);c.fill();
      c.strokeStyle='#89586a';c.lineWidth=.9;c.beginPath();c.ellipse(3,-22,1.6,snacking?.5+bite:1.6,0,.2,Math.PI*.8);c.stroke();
      // A little takeaway cup makes the obstruction feel like a party guest.
      if(snacking){c.font='11px "Segoe UI Emoji",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(guest.snackIcon||'🍪',8,-13-bite*8);c.fillStyle='#d2ac70';for(let i=0;i<3;i++){const fall=(time/320+i*.33)%1;c.beginPath();c.arc(6+i*2,-18+fall*12,.55,0,Math.PI*2);c.fill();}}
      else{c.fillStyle='#faf0d7';c.beginPath();c.roundRect(-12,-11,5,6,1);c.fill();c.strokeStyle='#b09083';c.lineWidth=.7;c.stroke();}
      if(chasing) {
        c.fillStyle='#f1c37d';c.strokeStyle='#a57343';c.lineWidth=.9;c.beginPath();c.arc(0,-42,5.5,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='#7b4e33';c.font='700 9px "DM Sans", sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('!',0,-41.5);
      }
      c.restore();
    }
    stealthFloor(state,time) {
      const stealth=state.stealth;
      if(!stealth||Number(this.world.level)!==Number(this.world.midnight?.level??3)||state.ending)return;
      const c=this.ctx,clock=Number(stealth.clock)||0;
      for(const surface of stealth.surfaces||[]) {
        const {x,y,w,h,type}=surface,cx=x+w/2,cy=y+h/2;
        if(type==='creak') {
          for(let i=0;i<4;i++) {
            const xx=x+.12+(w-.24)*i/3;
            this.line(xx,y+.12,.065,xx+.06,y+h*.37,.065,'rgba(202,170,113,.7)',1.1);
            this.line(xx+.06,y+h*.37,.065,xx-.04,y+h*.61,.065,'rgba(109,77,52,.5)',.8);
            this.line(xx-.04,y+h*.61,.065,xx+.03,y+h-.12,.065,'rgba(202,170,113,.7)',1.1);
          }
        } else if(type==='clink') {
          for(const [dx,dy,tilt]of[[.3,.35,-.35],[w*.65,h*.42,.2],[w*.48,h*.76,-.7]]) {
            const p=this.worldToScreen(x+dx,y+dy,.08),u=this.unit;
            c.save();c.translate(p.x,p.y);c.rotate(tilt);c.fillStyle='#6b9184';c.strokeStyle='#46695e';c.lineWidth=.75;c.beginPath();c.roundRect(-u*.055,-u*.27,u*.11,u*.25,u*.035);c.fill();c.stroke();c.fillStyle='#c3ce99';c.fillRect(-u*.03,-u*.33,u*.06,u*.08);c.fillStyle='#f0dbb2';c.fillRect(-u*.045,-u*.16,u*.09,u*.07);c.restore();
          }
        } else if(type==='quiet') {
          for(let i=0;i<3;i++) {
            this.ellipse(cx-.24+(i%2)*.48,y+.65+i*1.55,.075,.075,.12,'rgba(230,236,220,.37)');
          }
        } else if(type==='mask'&&surface.active) {
          const machines=(this.world.furniture||[]).filter(item=>item.type==='washer'&&item.room===surface.room);
          for(const machine of machines) {
            const p=this.worldToScreen(machine.x+machine.w*.5,machine.y+machine.h*.5,1.35),u=this.unit;
            c.save();c.strokeStyle='rgba(195,228,215,.65)';c.lineWidth=1.2;
            for(let i=0;i<2;i++){const wave=(clock*.8+i*.5)%1;c.globalAlpha=(1-wave)*.75;c.beginPath();c.ellipse(p.x,p.y,u*(.22+wave*.3),u*(.13+wave*.16),0,0,Math.PI*2);c.stroke();}c.restore();
          }
        }
        if(Math.hypot(state.player.x-cx,state.player.y-cy)>5.5)continue;
        const text=type==='mask'?(surface.active?'SPIN CYCLE · SOUND COVER':'WASHERS RESTING'):type==='quiet'?'SOFT RUG · QUIET STEPS':type==='creak'?'CREAKY BOARDS':'LOOSE BOTTLES';
        const p=this.worldToScreen(cx,y+h+.18,.08),color=type==='quiet'||type==='mask'&&surface.active?'#577b6d':'#947344';
        c.save();c.font='700 8px "DM Sans",sans-serif';c.textAlign='center';c.textBaseline='middle';const width=c.measureText(text).width+14;c.fillStyle='rgba(248,244,221,.9)';c.strokeStyle='rgba(152,142,112,.55)';c.lineWidth=.7;c.beginPath();c.roundRect(p.x-width/2,p.y,width,18,4);c.fill();c.stroke();c.fillStyle=color;c.fillText(text,p.x,p.y+9);c.restore();
      }
      const resident=stealth.resident,target=resident?.target;
      if(target&&['investigating','searching'].includes(stealth.mode)&&!stealth.safe) {
        const p=this.worldToScreen(target.x,target.y,.07),pulse=.5+.5*Math.sin(clock*4);
        c.save();c.strokeStyle='rgba(231,193,117,.7)';c.lineWidth=1.2;c.setLineDash([3,4]);c.beginPath();c.ellipse(p.x,p.y,12+pulse*5,6+pulse*2.5,0,0,Math.PI*2);c.stroke();c.setLineDash([]);c.fillStyle='#f0d9a5';c.font='700 11px "DM Sans",sans-serif';c.textAlign='center';c.fillText('?',p.x,p.y-10);c.restore();
      }
    }
    resident(person,state,time) {
      const c=this.ctx,p=this.worldToScreen(person.x,person.y,.06),u=Math.max(12,this.unit),chatting=state.conversation?.guestId===person.id;
      if(p.x<-u*2||p.x>this.width+u*2||p.y<-u||p.y>this.height+u*3)return;
      const clock=(Number(state.stealth?.clock)||0)*1000,stride=person.moving&&!chatting?Math.sin(clock/170):0,bob=Math.abs(stride)*.7;
      this.ellipse(person.x,person.y,.045,.45,.2,'rgba(38,42,58,.22)');
      c.save();c.translate(p.x,p.y-bob);c.scale((person.facing<0?-1:1)*u/18,u/18);c.lineCap='round';c.lineJoin='round';c.strokeStyle='#4b5367';c.lineWidth=1;
      c.fillStyle='#c6b6b8';c.beginPath();c.ellipse(-4-stride,-1+stride,4.4,2.4,-.1,0,Math.PI*2);c.ellipse(4+stride,-stride,4.4,2.4,-.1,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle='#9aa8bd';c.beginPath();c.moveTo(-6,-20);c.lineTo(6,-20);c.lineTo(9,-4);c.quadraticCurveTo(0,-.5,-9,-4);c.closePath();c.fill();c.stroke();
      c.strokeStyle='#d8d9dc';c.lineWidth=1.5;c.beginPath();c.moveTo(-4,-19);c.lineTo(1,-13);c.lineTo(5,-19);c.moveTo(-6,-9);c.lineTo(6,-9);c.stroke();c.fillStyle='#cbd0d9';c.beginPath();c.roundRect(1,-8,3,4,.7);c.fill();
      c.strokeStyle='#ddbb9c';c.lineWidth=3.5;c.beginPath();c.moveTo(-6,-17);c.lineTo(-9-stride,-9+stride);c.moveTo(6,-17);c.lineTo(chatting?10:8+stride,chatting?-18+Math.sin(clock/210):-10-stride);c.stroke();
      c.fillStyle='#ddbb9c';c.strokeStyle='#4b5367';c.lineWidth=1;c.beginPath();c.ellipse(0,-25,6.6,7.1,0,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle='#cbd1db';c.beginPath();c.moveTo(-7,-29);c.quadraticCurveTo(0,-40,8,-32);c.quadraticCurveTo(11,-28,13,-29);c.lineTo(10,-25);c.quadraticCurveTo(5,-28,-7,-27);c.closePath();c.fill();c.stroke();c.fillStyle='#f4edd4';c.beginPath();c.arc(12,-27,2,0,Math.PI*2);c.fill();c.stroke();c.strokeStyle='#f4edd4';c.lineWidth=2;c.beginPath();c.moveTo(-5,-28);c.lineTo(5,-28);c.stroke();
      c.strokeStyle='#4b5367';c.lineWidth=.85;c.beginPath();c.moveTo(1,-25);c.lineTo(4,-25);c.moveTo(1,-28);c.lineTo(4,-27);c.stroke();c.beginPath();c.ellipse(4,-21.5,1.3,chatting?1.2+Math.sin(clock/140)*.4:.4,0,0,Math.PI);c.stroke();
      c.fillStyle='#e8ddb8';c.strokeStyle='#8995a0';c.lineWidth=.7;c.beginPath();c.roundRect(-12,-12,5,6,1.2);c.fill();c.stroke();c.beginPath();c.arc(-6,-9,1.8,-Math.PI/2,Math.PI/2);c.stroke();c.restore();
    }
    stealthStatus(state,time) {
      const stealth=state.stealth;
      if(!stealth||Number(this.world.level)!==Number(this.world.midnight?.level??3)||state.ending)return;
      const c=this.ctx,clock=Number(stealth.clock)||0,last=stealth.lastNoise;
      if(!stealth.rippleUntil)this.noiseRipple=null;
      else if(last&&stealth.rippleUntil!==this.noiseRipple?.until&&stealth.rippleUntil>clock)this.noiseRipple={x:last.x,y:last.y,at:stealth.rippleUntil-.8,until:stealth.rippleUntil};
      const ripple=this.noiseRipple;
      if(ripple&&!stealth.safe&&clock>=ripple.at&&clock<ripple.until) {
        const progress=(clock-ripple.at)/.8,p=this.worldToScreen(ripple.x,ripple.y,.09),loud=stealth.noise>=50;
        c.save();c.strokeStyle=loud?'#e8b56c':'#efebcf';c.lineWidth=1.6;
        for(let i=0;i<2;i++){const wave=(progress+i*.22)%1;c.globalAlpha=(1-wave)*.65;c.beginPath();c.ellipse(p.x,p.y,8+wave*34,4+wave*17,0,0,Math.PI*2);c.stroke();}c.restore();
      }
      const resident=stealth.resident;
      if(!resident||resident.status==='sleeping'||state.conversation?.guestId===resident.id)return;
      if(this.world.getRoom(resident.x,resident.y,Number(this.world.level))?.id===this.world.home?.room)return;
      const distance=Math.hypot(resident.x-state.player.x,resident.y-state.player.y);
      if(distance>8)return;
      const p=this.worldToScreen(resident.x,resident.y,2.45);
      if(p.x<-100||p.x>this.width+100||p.y<-50||p.y>this.height+50)return;
      const text=resident.status==='returning'?'Mara · Back to bed…':resident.status==='searching'?'Where did that sound come from?':'Who’s still up?';
      c.save();c.font='600 10px "DM Sans",sans-serif';c.textAlign='center';c.textBaseline='middle';const width=c.measureText(text).width+20,left=Math.max(8,Math.min(this.width-width-8,p.x-width/2)),top=Math.max(80,p.y-12);c.fillStyle='#f8e8c9';c.strokeStyle='#ac946c';c.lineWidth=.9;c.beginPath();c.roundRect(left,top,width,24,7);c.fill();c.stroke();c.fillStyle='#786242';c.fillText(text,left+width/2,top+12);c.restore();
    }
    guestSpeech(state,time) {
      if(state.paused||state.won||state.failed)return;
      const conversation=state.conversation;
      const level=Number(this.world.level)||0;
      const guests=(state.guests||[]).filter(guest=>(Number(guest.level)||0)===level);
      const portrait=this.width<=700&&this.height>this.width;
      const safeTop=portrait?(conversation?.unskippable?300:286):this.height<=550?82:102,bottomClearance=portrait?190:90;
      const bubbleTop=(above,height,person)=>{
        const maximum=Math.max(12,this.height-bottomClearance-height),minimum=Math.min(safeTop,maximum);
        const feet=this.worldToScreen(person.x,person.y,.06);
        const desired=above>=minimum?above:feet.y+24;
        return Math.max(minimum,Math.min(maximum,desired));
      };
      let guest=conversation?guests.find(person=>person.id===conversation.guestId):null;
      if(conversation?.kind==='resident')guest=state.stealth?.resident||guest;
      if(!conversation) {
        const chasers=guests.filter(person=>person.chasing);
        let nearest=chasers.length?5.5:2.75;
        for(const person of chasers.length?chasers:guests) {
          const distance=Math.hypot(person.x-state.player.x,person.y-state.player.y);
          if(distance<nearest){nearest=distance;guest=person;}
        }
        if(!guest)return;
        const p=this.worldToScreen(guest.x,guest.y,2.8),c=this.ctx,text=guest.chasing?'! Hey! Wait up!':'Hey, real quick…';
        c.save();c.font='600 11px "DM Sans", sans-serif';c.textBaseline='middle';c.textAlign='center';
        const width=c.measureText(text).width+20,left=Math.max(8,Math.min(this.width-width-8,p.x-width/2)),top=bubbleTop(p.y-16,26,guest);
        c.fillStyle=guest.chasing?'#f9e0b9':'#f3e6f2';c.strokeStyle=guest.chasing?'#bd8c55':'#ab83a9';c.lineWidth=1;c.beginPath();c.roundRect(left,top,width,26,7);c.fill();c.stroke();
        c.fillStyle=guest.chasing?'#825237':'#785675';c.fillText(text,left+width/2,top+13);c.restore();return;
      }
      const c=this.ctx,p=this.worldToScreen(guest?.x??state.player.x,guest?.y??state.player.y,3.15);
      const width=Math.min(320,this.width-24),left=Math.max(12,Math.min(this.width-width-12,p.x-width/2));
      const remaining=Math.max(0,Number(conversation.remaining)||0);
      const lecture=conversation.kind==='resident'||conversation.unskippable;
      const required=Math.max(1,Number(conversation.escapeRequired)||12),presses=Math.min(required,Math.max(0,Number(conversation.escapePresses)||0));
      c.save();c.font='500 13px "DM Sans", sans-serif';c.textBaseline='middle';c.textAlign='left';
      const speech=String(conversation.line||'So, I was just thinking…'),speechWidth=width-28;
      let layout=this.speechLayout;
      if(!layout||layout.text!==speech||layout.width!==speechWidth) {
        const words=speech.split(/\s+/),wrap=font=>{
          c.font=`500 ${font}px "DM Sans", sans-serif`;
          const rows=[];let row='';
          for(const word of words){const next=row?`${row} ${word}`:word;if(c.measureText(next).width>speechWidth&&row){rows.push(row);row=word;}else row=next;}
          if(row)rows.push(row);return rows;
        };
        let font=13,rows=wrap(font);
        while(rows.length>3&&font>11.5){font-=.5;rows=wrap(font);}
        // Keep every word if a future line exceeds the authored length limit.
        // Canvas maxWidth gently fits the final row inside the existing card.
        if(rows.length>3)rows=[rows[0],rows[1],rows.slice(2).join(' ')];
        layout=this.speechLayout={text:speech,width:speechWidth,font,rows};
      }
      const shown=layout.rows,height=104+shown.length*17,top=bubbleTop(p.y-height+4,height,guest||state.player);
      c.shadowColor='rgba(43,29,52,.22)';c.shadowBlur=16;c.shadowOffsetY=4;c.fillStyle=lecture?'#3e4959':'#4d3c5c';c.beginPath();c.roundRect(left,top,width,height,11);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
      c.fillStyle=lecture?'#f2d7a7':'#e6c4e5';c.font='700 10px "Space Grotesk", sans-serif';c.fillText(lecture?`${String(conversation.name||guest?.name||'RESIDENT').toUpperCase()} · A QUIET WORD…`:`${String(conversation.name||guest?.name||'GUEST').toUpperCase()} WON’T STOP TALKING`,left+14,top+18);
      c.fillStyle='#fff4fa';c.font=`500 ${layout.font}px "DM Sans", sans-serif`;shown.forEach((text,i)=>c.fillText(text,left+14,top+40+i*17,speechWidth));
      const labelY=top+47+shown.length*17,trackY=labelY+11;
      if(lecture) {
        const progress=Math.max(0,Math.min(1,1-remaining/(Number(conversation.duration)||6)));
        c.fillStyle='#f2dbb5';c.font='700 11px "DM Sans",sans-serif';c.fillText('LISTEN…',left+14,labelY);c.textAlign='right';c.fillText(`${remaining.toFixed(1)}s`,left+width-14,labelY);c.textAlign='left';
        c.fillStyle='#657080';c.beginPath();c.roundRect(left+14,trackY,width-28,6,3);c.fill();if(progress>0){c.fillStyle='#e8c890';c.beginPath();c.roundRect(left+14,trackY,Math.max(3,(width-28)*progress),6,3);c.fill();}
        c.fillStyle='#e3d8c5';c.font='500 10px "DM Sans",sans-serif';c.fillText('No skipping · Time and energy still drain',left+14,top+height-17);c.restore();return;
      }
      c.fillStyle='#f4dbef';c.font='700 11px "DM Sans", sans-serif';c.fillText('E / SPACE · NEXT LINE',left+14,labelY);c.textAlign='right';c.fillText(`${presses} / ${required} TAPS`,left+width-14,labelY);c.textAlign='left';
      c.fillStyle='#715c7c';c.beginPath();c.roundRect(left+14,trackY,width-28,6,3);c.fill();
      if(presses>0){c.fillStyle='#e0add4';c.beginPath();c.roundRect(left+14,trackY,Math.max(3,(width-28)*presses/required),6,3);c.fill();}
      c.fillStyle='#f0dbef';c.font='500 10px "DM Sans", sans-serif';c.fillText(`Break away · −${Number(conversation.excuseCost)||4} energy`,left+14,top+height-17);
      c.textAlign='right';c.fillStyle='#ceb4d0';c.fillText(`Story: ${remaining.toFixed(1)}s`,left+width-14,top+height-17);
      c.restore();
    }
    snack(snack,state,time) {
      if((Number(snack.level)||0)!==(Number(this.world.level)||0))return;
      if(state.wing?.consumed?.has(snack.id))return;
      if(state.found?.has(snack.id))return;
      // The hunt reveals snacks through exploration; an overview cannot expose
      // hiding spots. Omitted discovery state keeps older previews compatible.
      if(state.discovered && !state.discovered.has(snack.id) && state.hintTarget!==snack.id)return;
      const c=this.ctx,p=this.worldToScreen(snack.x,snack.y,1.04),hint=state.hintTarget===snack.id,pulse=Math.sin(time/400)*.5+.5;
      c.save();
      if(hint) {
        c.strokeStyle='#d99240';c.lineWidth=2;c.setLineDash([3,4]);c.beginPath();c.ellipse(p.x,p.y+2,15+pulse*5,8+pulse*3,0,0,Math.PI*2);c.stroke();c.setLineDash([]);
        c.fillStyle='#d99240';c.beginPath();c.moveTo(p.x,p.y-25-pulse*4);c.lineTo(p.x-4,p.y-31-pulse*4);c.lineTo(p.x+4,p.y-31-pulse*4);c.closePath();c.fill();
      }
      const glowRadius=hint?15:11,g=c.createRadialGradient(p.x,p.y,1,p.x,p.y,glowRadius);g.addColorStop(0,hint?'rgba(255,235,156,.48)':'rgba(255,235,156,.24)');g.addColorStop(1,'rgba(255,235,156,0)');c.fillStyle=g;c.fillRect(p.x-glowRadius,p.y-glowRadius,glowRadius*2,glowRadius*2);
      c.font=`${Math.max(13,Math.min(26,this.unit*.88))}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(snack.icon||'🍪',p.x,p.y-1);
      if(hint&&pulse>.7) {
        c.strokeStyle='#faf1c1';c.lineWidth=1.2;c.beginPath();c.moveTo(p.x+9,p.y-11);c.lineTo(p.x+9,p.y-5);c.moveTo(p.x+6,p.y-8);c.lineTo(p.x+12,p.y-8);c.stroke();
      }
      c.restore();
    }
    roomLabel(room,active,state) {
      const home=Number(this.world.level)===this.world.home?.level&&room.id===this.world.home?.room;
      if(home)return; // The couch marker already names this room and its action.
      const c=this.ctx,p=this.worldToScreen(room.x+room.w/2,room.y+room.h-.7,.04),text=(room.shortName||room.name).toUpperCase();
      c.save();c.font=`600 ${Math.max(8,Math.min(11,this.unit*.48))}px "Space Grotesk", sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const w=c.measureText(text).width+23,h=22;
      c.fillStyle=active?'#526347':'rgba(247,239,214,.86)';c.strokeStyle=active?'#42533a':'rgba(79,83,57,.34)';c.lineWidth=.7;c.beginPath();c.roundRect(p.x-w/2,p.y-h/2,w,h,3);c.fill();c.stroke();c.fillStyle=active?'#f8f3de':'#5a634b';c.fillText(text,p.x,p.y+.5);c.restore();
    }
    homeZone(state,time) {
      const home=this.world.home;
      if(!home||Number(this.world.level)!==home.level)return;
      const c=this.ctx,p=this.worldToScreen(home.x,home.y,.075),u=this.unit;
      const ready=!!state.homeAvailable,pulse=ready&&!state.paused?(Math.sin(time/500)*.5+.5):.25;
      c.save();
      c.fillStyle=ready?'rgba(205,227,137,.24)':'rgba(224,232,190,.13)';
      c.strokeStyle=ready?'rgba(111,142,60,.8)':'rgba(104,128,76,.52)';c.lineWidth=ready?1.7:1.1;
      c.setLineDash([4,5]);c.beginPath();c.ellipse(p.x,p.y,home.radius*u*1.05,home.radius*u*.53,0,0,Math.PI*2);c.fill();c.stroke();c.setLineDash([]);
      c.strokeStyle=ready?`rgba(125,154,68,${.4+pulse*.25})`:'rgba(119,140,87,.25)';c.lineWidth=1;
      c.beginPath();c.ellipse(p.x,p.y,(home.radius*.84)*u,(home.radius*.42)*u,0,0,Math.PI*2);c.stroke();
      c.restore();
    }
    homeMarker(state) {
      const home=this.world.home;
      if(!home||Number(this.world.level)!==home.level)return;
      const c=this.ctx,p=this.worldToScreen(home.x,home.y,.09),ready=!!state.homeAvailable;
      const label=ready?'⌂ TV SNUG · END RUN':'⌂ HOME · PRIVATE TV SNUG';
      c.save();c.font=`600 ${Math.max(8,Math.min(10,this.unit*.4))}px "Space Grotesk", sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const width=c.measureText(label).width+18,height=19,top=p.y+home.radius*this.unit*.58+7;
      c.fillStyle=ready?'rgba(224,238,180,.96)':'rgba(247,242,218,.88)';c.strokeStyle=ready?'#8da15c':'rgba(100,119,77,.4)';c.lineWidth=.8;
      c.beginPath();c.roundRect(p.x-width/2,top,width,height,4);c.fill();c.stroke();c.fillStyle=ready?'#506a35':'#75815e';c.fillText(label,p.x,top+height/2+.3);c.restore();
    }
    transitionPoint(anchor,orientation,across,along) {
      const run={east:[1,0],west:[-1,0],north:[0,-1],south:[0,1]}[orientation]||[1,0];
      return {x:anchor.x-run[1]*across+run[0]*along,y:anchor.y+run[0]*across+run[1]*along};
    }
    transitionPlane(anchor,orientation,across,along,width,length,z,color,stroke=INK,lineWidth=.8) {
      const points=[[across,along],[across+width,along],[across+width,along+length],[across,along+length]].map(([a,b])=>{const p=this.transitionPoint(anchor,orientation,a,b);return this.worldToScreen(p.x,p.y,z);});
      this.poly(points,color,stroke,lineWidth);
    }
    transitionBox(anchor,orientation,across,along,width,length,z,color,base=0) {
      const a=this.transitionPoint(anchor,orientation,across,along),b=this.transitionPoint(anchor,orientation,across+width,along+length);
      this.box(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y),z,color,base);
    }
    doorWallSegments(rect) {
      let parts=[rect];
      for(const door of this.floorData()?.doors||[]) {
        const anchor=door.anchor||door,vertical=door.orientation==='east'||door.orientation==='west';
        if(vertical?rect.h<=rect.w||Math.abs(rect.x-anchor.x)>1.25:rect.w<rect.h||Math.abs(rect.y-anchor.y)>1.25)continue;
        const low=(vertical?anchor.y:anchor.x)-(door.openingWidth||2.4)*.5,high=(vertical?anchor.y:anchor.x)+(door.openingWidth||2.4)*.5,next=[];
        for(const part of parts) {
          const start=vertical?part.y:part.x,end=start+(vertical?part.h:part.w);
          if(high<=start||low>=end){next.push(part);continue;}
          if(low>start)next.push(vertical?{...part,h:low-start}:{...part,w:low-start});
          if(high<end)next.push(vertical?{...part,y:high,h:end-high}:{...part,x:high,w:end-high});
        }
        parts=next;
      }
      return parts;
    }
    stairsGeometry() {
      const stair=this.floorData()?.stair;
      if(!stair)return;
      const anchor=stair.anchor||stair,orientation=stair.orientation||'east',length=stair.length||3,width=stair.width||1.5,down=stair.direction==='down';
      const c=this.ctx,side=width*.5,entry=-length*.5;
      this.transitionPlane(anchor,orientation,-side,entry-.8,width,.8,.055,'#ded8b8','#8b8c72',.8);
      const rail=(s,a,b,zA,zB,color)=>{const p=this.transitionPoint(anchor,orientation,s,a),q=this.transitionPoint(anchor,orientation,s,b);this.line(p.x,p.y,zA,q.x,q.y,zB,color,2);};
      if(down) {
        this.transitionPlane(anchor,orientation,-side,entry,width,length,.035,'#333b43','#a69ca9',1.5);
        const opening=[[-side,entry],[side,entry],[side,-entry],[-side,-entry]].map(([s,t])=>{const p=this.transitionPoint(anchor,orientation,s,t);return this.worldToScreen(p.x,p.y,.036);});
        c.save();c.beginPath();opening.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.clip();
        this.transitionPlane(anchor,orientation,-side,entry,width,length,-1.25,'#202b34',null);
        const steps=[];
        for(let i=0;i<7;i++){const t=entry+i*length/7,p=this.transitionPoint(anchor,orientation,0,t);steps.push({t,z:-.03-i*.17,depth:p.x+p.y});}
        steps.sort((a,b)=>a.depth-b.depth).forEach(step=>this.transitionBox(anchor,orientation,-side+.08,step.t,width-.16,length/7,step.z,'#9a9ba7',step.z-.17));
        c.restore();
        for(const s of [-side-.07,side-.05])this.transitionBox(anchor,orientation,s,entry,.12,length,.095,'#c5b6bf',.035);
        this.transitionBox(anchor,orientation,-side,-entry-.1,width,.12,.12,'#c5b6bf',.035);
        for(const s of [-side-.02,side+.02]){rail(s,entry,-entry,.78,.2,'#8c7c96');for(let i=0;i<3;i++){const t=entry+i*length/2,p=this.transitionPoint(anchor,orientation,s,t),z=.78-i*.29;this.line(p.x,p.y,.1,p.x,p.y,z,'#8c7c96',1.3);}}
      } else {
        this.transitionPlane(anchor,orientation,-side,entry,width,length,.04,'#b7ad8f','#7e8269',.8);
        const steps=[];
        for(let i=0;i<7;i++){const t=entry+i*length/7,p=this.transitionPoint(anchor,orientation,0,t);steps.push({t,z:.12+(i+1)*.17,depth:p.x+p.y});}
        steps.sort((a,b)=>a.depth-b.depth).forEach(step=>this.transitionBox(anchor,orientation,-side,step.t,width,length/7,step.z,'#dfcfab',.045));
        for(const s of [-side-.03,side+.03]){rail(s,entry,-entry,.94,2.1,'#a28c61');for(let i=0;i<4;i++){const t=entry+i*length/3,p=this.transitionPoint(anchor,orientation,s,t),base=.12+i*.397;this.line(p.x,p.y,base,p.x,p.y,base+.78,'#9b865e',1.3);}}
      }
    }
    wingWayfinding() {
      const wing=this.world.wing,trail=wing?.pawTrail;
      if(Number(this.world.level)!==2||!trail?.length)return;
      const c=this.ctx;
      for(let segment=1;segment<trail.length;segment++) {
        const a=trail[segment-1],b=trail[segment],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),count=Math.max(1,Math.ceil(length/1.2));
        for(let step=0;step<count;step++) {
          const t=(step+.45)/count,x=a.x+dx*t,y=a.y+dy*t;
          if(!this.world.isWalkable(x,y,.15,2)||Math.hypot(x-(wing.toy?.x??-20),y-(wing.toy?.y??-20))<1||Math.hypot(x-wing.bowl.x,y-wing.bowl.y)<1)continue;
          const p=this.worldToScreen(x,y,.065),direction=this.worldToScreen(x+dx/Math.max(length,.01),y+dy/Math.max(length,.01),.065),size=Math.max(2.8,this.unit*.17);
          c.save();c.translate(p.x,p.y);c.rotate(Math.atan2(direction.y-p.y,direction.x-p.x)+Math.PI/2);c.scale(size/6,size/6);c.fillStyle='rgba(112,135,96,.58)';
          c.beginPath();c.ellipse(0,2,3.2,2.2,0,0,Math.PI*2);c.ellipse(-3.2,-1.6,1.25,1.5,-.35,0,Math.PI*2);c.ellipse(0,-3.1,1.3,1.6,0,0,Math.PI*2);c.ellipse(3.2,-1.6,1.25,1.5,.35,0,Math.PI*2);c.fill();c.restore();
        }
      }
      const sign=this.worldToScreen(12,16.5,.075);c.save();c.font=`700 ${Math.max(7,Math.min(10,this.unit*.42))}px "DM Sans",sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const text='🐾 DINNER TRAIL →',width=c.measureText(text).width+16;c.fillStyle='rgba(240,243,214,.92)';c.strokeStyle='#9cac83';c.lineWidth=.6;c.beginPath();c.roundRect(sign.x-width/2,sign.y+6,width,19,4);c.fill();c.stroke();c.fillStyle='#708658';c.fillText(text,sign.x,sign.y+15.5);c.restore();
    }
    doorGeometry() {
      for(const door of this.floorData()?.doors||[]) {
        const anchor=door.anchor||door,orientation=door.orientation||'south',width=door.openingWidth||2.4,half=width*.5;
        this.transitionPlane(anchor,orientation,-half,-1.05,width,1.45,.055,'#becbad','#7d9371',1);
        this.transitionPlane(anchor,orientation,-half+.2,-.8,width-.4,.7,.06,'#e1e7c3',null);
        const aperture=[[-half,0,.06],[half,0,.06],[half,0,1.95],[-half,0,1.95]].map(([s,t,z])=>{const p=this.transitionPoint(anchor,orientation,s,t);return this.worldToScreen(p.x,p.y,z);});
        this.poly(aperture,'#77948a','#536c60',1);
        // A shallow reveal joins western frames to the cut rear wall.
        if(orientation==='west'&&anchor.x<1.2)for(const y of [anchor.y-half-.18,anchor.y+half])this.box(0,y,anchor.x+.1,.18,1.8,'#d3d5b5');
        for(const s of [-half-.1,half-.08])this.transitionBox(anchor,orientation,s,-.13,.18,.27,2.03,'#a8ba96',.055);
        this.transitionBox(anchor,orientation,-half-.1,-.15,width+.2,.31,2.18,'#c8d6af',1.97);
        const icon=door.to===this.world.wing?.level?'🐾':door.to===this.world.midnight?.level?'☾':door.to===1?'↑':'⌂';
        const p=this.worldToScreen(door.x,door.y,.075),c=this.ctx;c.save();c.font=`${Math.max(14,this.unit*.55)}px "Segoe UI Emoji",sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(icon,p.x,p.y);c.restore();
      }
    }
    doorMarkers(state,time) {
      const c=this.ctx;
      for(const door of this.floorData()?.doors||[]) {
        const p=this.worldToScreen(door.x,door.y,.08),near=!!state.nearDoor&&Math.hypot(state.player.x-door.x,state.player.y-door.y)<=door.radius;
        const destination=this.world.floors?.find(floor=>floor.id===door.to),icon=door.to===this.world.wing?.level?'🐾':door.to===this.world.midnight?.level?'☾':door.to===1?'↑':'⌂';
        const text=`${icon} ${(destination?.name||door.label||'Doorway').toUpperCase()}`;
        c.save();c.font=`700 ${Math.max(8,Math.min(10,this.unit*.42))}px "Space Grotesk",sans-serif`;c.textAlign='center';c.textBaseline='middle';
        const width=Math.min(this.width-24,c.measureText(text).width+20),left=Math.max(12,Math.min(this.width-width-12,p.x-width/2)),top=Math.min(this.height-68,p.y+this.unit*.85);
        c.fillStyle=near?'#e2edc5':'rgba(247,244,218,.94)';c.strokeStyle='#839e68';c.lineWidth=.8;c.beginPath();c.roundRect(left,top,width,22,5);c.fill();c.stroke();c.fillStyle='#566f43';c.fillText(text,left+width/2,top+11,width-14);c.restore();
      }
    }
    dogBowl(state,time) {
      const bowl=this.world.wing?.bowl;if(Number(this.world.level)!==2||!bowl)return;
      const filled=!state.wing?.taskCompleted;
      this.ellipse(bowl.x,bowl.y,.06,.63,.35,'rgba(52,65,42,.15)');
      this.ellipse(bowl.x,bowl.y,.19,.53,.29,'#789f91','#486b60',1);
      this.ellipse(bowl.x,bowl.y,.27,.5,.25,'#c2ddd1','#4f7768',.8);
      this.ellipse(bowl.x,bowl.y,.28,.36,.17,filled?'#9c7048':'#a9c7bc');
      if(filled){const c=this.ctx;c.fillStyle='#d7aa61';for(let i=0;i<8;i++){const p=this.worldToScreen(bowl.x+Math.cos(i*2.4)*.25,bowl.y+Math.sin(i*2.4)*.15,.3);c.beginPath();c.arc(p.x,p.y,Math.max(1,this.unit*.04),0,Math.PI*2);c.fill();}}
      const p=this.worldToScreen(bowl.x,bowl.y,.1),c=this.ctx,text=filled?'WAFFLES’ DINNER':'HAPPY DOG · EMPTY BOWL';c.save();c.font='600 9px "DM Sans",sans-serif';c.textAlign='center';c.textBaseline='middle';const width=c.measureText(text).width+16;c.fillStyle='#f8f3d9';c.strokeStyle='#9caf82';c.lineWidth=.7;c.beginPath();c.roundRect(p.x-width/2,p.y+this.unit*.38,width,20,4);c.fill();c.stroke();c.fillStyle='#697d51';c.fillText(text,p.x,p.y+this.unit*.38+10);c.restore();
    }
    toyStation(state,time) {
      const toy=this.world.wing?.toy;if(Number(this.world.level)!==2||!toy)return;
      const used=!!state.wing?.toy?.used,c=this.ctx,p=this.worldToScreen(toy.x,toy.y,.3),u=this.unit;
      if(p.x<-u||p.x>this.width+u||p.y<-u||p.y>this.height+u)return;
      const playing=used&&Number(state.wing?.clock)-Number(state.wing?.toy?.usedAt)<2;
      this.ellipse(toy.x,toy.y,.07,.8,.39,used?'#c7c7a9':'#ead5a1',used?'#a6af91':'#b79b61',1);
      this.ellipse(toy.x,toy.y,.075,.63,.29,null,used?'#b3baa0':'#f7e8bd',1);
      const bounce=playing?Math.abs(Math.sin(time/105))*u*.18:0;
      c.save();c.translate(p.x,p.y-bounce);c.fillStyle=used?'#a8b89b':'#aacb73';c.strokeStyle=used?'#8a9e7d':'#6d9249';c.lineWidth=1;c.beginPath();c.ellipse(0,0,Math.max(5,u*.24),Math.max(4,u*.21),0,0,Math.PI*2);c.fill();c.stroke();
      c.strokeStyle=used?'#c7d1bc':'#e9f4be';c.lineWidth=Math.max(1,u*.04);c.beginPath();c.moveTo(-u*.16,-u*.13);c.quadraticCurveTo(u*.08,-u*.04,-u*.1,u*.14);c.moveTo(u*.14,-u*.12);c.quadraticCurveTo(-u*.05,u*.05,u*.15,u*.12);c.stroke();c.restore();
    }
    toyMarker(state) {
      const toy=this.world.wing?.toy;if(Number(this.world.level)!==2||!toy)return;
      if(Math.hypot(state.player.x-toy.x,state.player.y-toy.y)>5.8)return;
      const used=!!state.wing?.toy?.used,near=!!state.nearToy&&!state.nearDog&&!state.paused&&!state.conversation&&!state.won&&!state.failed;
      const c=this.ctx,p=this.worldToScreen(toy.x,toy.y,.08),text=used?'SQUEAKY BREAK · PLAYED ALREADY':near?`E · Play with Waffles · +${toy.energy??25} energy`:`SQUEAKY BREAK · +${toy.energy??25} FOR WAFFLES`;
      c.save();c.font=`${near?'700 10':'600 8'}px "DM Sans",sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const width=Math.min(this.width-24,c.measureText(text).width+20),left=Math.max(12,Math.min(this.width-width-12,p.x-width/2)),top=Math.min(this.height-100,p.y+this.unit*.45+8);
      c.fillStyle=used?'rgba(233,234,213,.94)':near?'#edf4c5':'#fff1d2';c.strokeStyle=used?'#a5b095':'#b0a467';c.lineWidth=near?1.2:.8;c.beginPath();c.roundRect(left,top,width,near?28:22,6);c.fill();c.stroke();c.fillStyle=used?'#8e9a7d':'#74894e';c.fillText(text,left+width/2,top+(near?14:11),width-14);c.restore();
    }
    endingDogPose(state,time,playerPose) {
      const dog=state.wing?.dog,shot=this.endingShot,ending=state.ending,area=Number(this.world.level)||0;
      if(!ending||!shot||!dog?.happy||!state.wing.taskCompleted||Number(dog.level)!==area)return null;
      const elapsed=Math.max(0,Number(ending.elapsed)||0);
      if(!shot.dogScene) {
        const sofa=shot.sofa,seat=shot.seat||this.world.home?.seat||sofa&&{x:sofa.x+sofa.w*.5,y:sofa.y+sofa.h*.5}||playerPose||state.player,orientation=sofa?.orientation||'north';
        const front=orientation==='south'?{x:0,y:1}:orientation==='east'?{x:1,y:0}:orientation==='west'?{x:-1,y:0}:{x:0,y:-1};
        const side={x:-front.y,y:front.x};
        const edge=sofa?orientation==='north'?{x:seat.x,y:sofa.y}:orientation==='south'?{x:seat.x,y:sofa.y+sofa.h}:orientation==='east'?{x:sofa.x+sofa.w,y:seat.y}:{x:sofa.x,y:seat.y}:seat;
        const beside=front.x ? .65 : -.65;
        const candidates=[shot.companionAnchor,...[beside,0,-beside,beside*2,-beside*2].map(offset=>({x:edge.x+front.x*.7+side.x*offset,y:edge.y+front.y*.7+side.y*offset}))].filter(Boolean);
        const anchor=candidates.find(point=>!this.world.isWalkable||this.world.isWalkable(point.x,point.y,.25,area))||candidates[0];
        const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
        const cushionAnchor=sofa?{x:clamp(seat.x+side.x*1.05,sofa.x+Math.min(.6,sofa.w*.3),sofa.x+sofa.w-Math.min(.6,sofa.w*.3)),y:clamp(seat.y+side.y*1.05,sofa.y+Math.min(.4,sofa.h*.3),sofa.y+sofa.h-Math.min(.4,sofa.h*.3))}:null;
        shot.dogScene={from:{x:dog.x,y:dog.y},anchor,cushionAnchor,seat:{x:seat.x,y:seat.y},orientation,sofaDepth:sofa?sofa.x+sofa.y+(sofa.w+sofa.h)*.5+.03:null};
      }
      const scene=shot.dogScene,progress=Math.min(1,elapsed/2),walk=progress*progress*(3-2*progress),hop=scene.cushionAnchor?Math.max(0,Math.min(1,(elapsed-2)/.6)):0,rise=hop*hop*(3-2*hop);
      const floor={x:scene.from.x+(scene.anchor.x-scene.from.x)*walk,y:scene.from.y+(scene.anchor.y-scene.from.y)*walk},cushion=scene.cushionAnchor||floor;
      const screenSide=(cushion.x-scene.seat.x)-(cushion.y-scene.seat.y);
      return {...dog,x:floor.x+(cushion.x-floor.x)*rise,y:floor.y+(cushion.y-floor.y)*rise,z:.06+.78*rise+Math.sin(hop*Math.PI)*.25,
        painterDepth:hop>0?scene.sofaDepth:null,facing:screenSide>0?-1:1,moving:elapsed<2.6,sleeping:elapsed>=2.6,status:elapsed>=2.6?'curled':'following',
        curled:elapsed>=2.6,cinematic:true,animationTime:ending.active||ending.paused?elapsed*1000:time};
    }
    corgi(dog,state,time) {
      if(Number.isFinite(dog.animationTime))time=dog.animationTime;
      const z=Number.isFinite(dog.z)?dog.z:.06,p=this.worldToScreen(dog.x,dog.y,z),c=this.ctx,u=Math.max(15,this.unit),sleeping=dog.sleeping,happy=dog.happy,playing=!dog.sleeping&&!dog.happy&&dog.playUntil>state.wing?.clock;
      if(p.x<-u*3||p.x>this.width+u*3||p.y<-u*3||p.y>this.height+u*3)return;
      if(sleeping) {
        const breath=Math.sin(time/650)*.035;
        this.ellipse(dog.x,dog.y,z-.01,.59,.26,'rgba(57,62,35,.18)');
        c.save();c.translate(p.x,p.y);c.scale((dog.facing<0?-1:1)*u/18,u/18);c.lineCap='round';c.lineJoin='round';c.strokeStyle='#8b6440';c.lineWidth=.9;
        c.fillStyle='#d58d4d';c.beginPath();c.ellipse(-1,-7,15,7.5*(1+breath),-.07,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='#fff0cb';c.beginPath();c.ellipse(-5,-3,10,3.2,0,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='#d58d4d';c.beginPath();c.ellipse(9,-5,7.5,5.8,-.15,0,Math.PI*2);c.fill();c.stroke();
        c.beginPath();c.moveTo(4,-8);c.lineTo(2,-17);c.quadraticCurveTo(8,-17,10,-10);c.lineTo(12,-13);c.quadraticCurveTo(16,-8,15,-4);c.fill();c.stroke();
        c.fillStyle='#e8b797';c.beginPath();c.moveTo(5,-10);c.lineTo(4,-14);c.lineTo(8,-11);c.fill();
        c.fillStyle='#fff0cb';c.beginPath();c.ellipse(12,-1.5,5.5,3.1,0,0,Math.PI*2);c.fill();
        c.strokeStyle='#674a35';c.lineWidth=1.1;c.beginPath();c.moveTo(7,-5);c.quadraticCurveTo(9,-3.3,11,-5);c.stroke();
        c.fillStyle='#493d32';c.beginPath();c.ellipse(16,-2,1.7,1.3,0,0,Math.PI*2);c.fill();
        c.fillStyle='#fff0cb';c.strokeStyle='#8b6440';c.lineWidth=.8;c.beginPath();c.moveTo(-15,-8);c.bezierCurveTo(-22,-2,-10,4,1,0);c.quadraticCurveTo(5,-2,2,-3.7);c.bezierCurveTo(-5,-.3,-15,-1,-15,-8);c.fill();c.stroke();c.restore();
        if(dog.cinematic){c.save();c.font=`500 ${Math.max(10,Math.min(15,u*.35))}px "DM Sans",sans-serif`;c.fillStyle='#eff3d5';c.strokeStyle='rgba(84,104,63,.35)';c.lineWidth=2.5;c.textAlign='center';const z='z z z',top=p.y-u*.9-Math.sin(time/750)*2;c.strokeText(z,p.x+u*.35,top);c.fillText(z,p.x+u*.35,top);c.restore();}
        return;
      }
      const stride=dog.moving?Math.sin(time/85):playing?Math.sin(time/80)*.5:0,bob=(dog.moving?Math.abs(stride)*1.3:0)+(playing?Math.abs(Math.sin(time/115))*u*.14:0);
      this.ellipse(dog.x,dog.y,z-.01,.64,.24,'rgba(57,62,35,.2)');
      c.save();c.translate(p.x,p.y-bob);c.scale((dog.facing<0?-1:1)*u/18,u/18);c.lineCap='round';c.lineJoin='round';
      const orange='#d58d4d',cream='#fff0cb',outline='#8b6440';c.strokeStyle=outline;c.lineWidth=.9;
      c.save();c.translate(-15,-11);c.rotate(sleeping ? .15 : Math.sin(time/(happy||playing?60:110))*(happy||playing ? .45 : .25));c.fillStyle=cream;c.beginPath();c.ellipse(-3,-2,6,3.3,-.4,0,Math.PI*2);c.fill();c.stroke();c.restore();
      c.fillStyle=orange;c.beginPath();c.ellipse(-1,sleeping?-6:-10,16,sleeping?6.5:9,0,0,Math.PI*2);c.fill();c.stroke();
      if(!sleeping){c.fillStyle=cream;c.beginPath();c.ellipse(4,-8,8,6.5,0,0,Math.PI);c.fill();c.fillStyle=orange;for(const [x,s]of[[-11,-1],[-4,1],[7,-1],[12,1]]){c.beginPath();c.roundRect(x,-7,4.3,9+stride*s,2);c.fill();c.stroke();c.fillStyle=cream;c.beginPath();c.roundRect(x,-1+stride*s,4.3,3,1);c.fill();c.fillStyle=orange;}}
      const headY=sleeping?-7:dog.status==='eating'?-12+Math.sin(time/90)*1.2:playing?-19+Math.sin(time/115)*1.5:-18;
      c.save();c.translate(12,headY);
      c.fillStyle=orange;c.beginPath();c.moveTo(-7,-4);c.lineTo(-8,-18);c.quadraticCurveTo(0,-17,2,-5);c.moveTo(3,-6);c.lineTo(10,-18);c.quadraticCurveTo(15,-9,10,1);c.closePath();c.fill();c.stroke();
      c.fillStyle='#e8b797';c.beginPath();c.moveTo(-5,-7);c.lineTo(-6,-14);c.lineTo(0,-7);c.moveTo(5,-6);c.lineTo(9,-13);c.lineTo(10,-3);c.fill();
      c.fillStyle=orange;c.beginPath();c.ellipse(1,-1,9,8.5,0,0,Math.PI*2);c.fill();c.stroke();
      c.fillStyle=cream;c.beginPath();c.moveTo(-2,-9);c.lineTo(2,-9);c.lineTo(4,-1);c.lineTo(1,5);c.lineTo(-2,1);c.closePath();c.fill();c.beginPath();c.ellipse(6,3,5.7,4.3,0,0,Math.PI*2);c.fill();
      c.strokeStyle='#674a35';c.lineWidth=1.2;c.beginPath();if(sleeping){c.moveTo(3,-2);c.quadraticCurveTo(5,0,7,-2);}else{c.fillStyle='#493d32';c.arc(5,-3,1.4,0,Math.PI*2);c.fill();c.fillStyle='#fff6df';c.beginPath();c.arc(5.4,-3.4,.4,0,Math.PI*2);c.fill();}c.stroke();
      c.fillStyle='#493d32';c.beginPath();c.ellipse(10,2,2,1.5,0,0,Math.PI*2);c.fill();
      c.strokeStyle='#805c3f';c.lineWidth=.8;c.beginPath();c.moveTo(9,4);c.quadraticCurveTo(6,6,4,4);c.stroke();if(happy||playing||dog.following){c.fillStyle='#e89788';c.beginPath();c.roundRect(6,4.8,3,4,1.5);c.fill();}
      c.restore();c.restore();
    }
    dogStatus(state,time) {
      if(state.conversation?.kind==='resident')return;
      const dog=state.wing?.dog;if(!dog||Number(dog.level)!==Number(this.world.level)||state.ending)return;
      const playing=!dog.sleeping&&!dog.happy&&dog.playUntil>state.wing.clock;
      const c=this.ctx,p=this.worldToScreen(dog.x,dog.y,2.2),amount=Math.max(0,Math.min(100,dog.energy));
      if(p.x<-90||p.x>this.width+90||p.y<-100||p.y>this.height+100)return;
      const width=92,left=Math.max(8,Math.min(this.width-width-8,p.x-width/2)),top=Math.max(88,p.y-13);
      c.save();c.fillStyle='rgba(255,250,229,.96)';c.strokeStyle='#b29870';c.lineWidth=.8;c.beginPath();c.roundRect(left,top,width,33,7);c.fill();c.stroke();c.font='700 8px "DM Sans",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#80613c';c.fillText(`${dog.name.toUpperCase()} · ${Math.ceil(amount)}%`,left+width/2,top+10);c.fillStyle='#e1dac2';c.beginPath();c.roundRect(left+9,top+20,width-18,5,2.5);c.fill();if(amount>0){c.fillStyle=dog.sleeping?'#a6ada1':amount<25?'#d29262':amount<50?'#c7ad63':'#91b66e';c.beginPath();c.roundRect(left+9,top+20,(width-18)*amount/100,5,2.5);c.fill();}
      let text='';if(dog.sleeping)text=state.nearDog?'Zzz… E · Wake & follow':'Zzz… sweet snack dreams';else if(dog.happy)text='♥ Your couch? Our couch.';else if(dog.status==='eating')text='Nom nom nom…';else if(playing)text='Squeak! Ready for the dinner trail!';else if(dog.status==='sniffing')text=state.nearDog?'E · Come on, little sniffer!':dog.distractionReason||'Something smells amazing…';else if(dog.status==='waiting')text=state.nearDog?'E · You can do it, Waffles!':'Tiny legs. Come back for me!';else if(dog.following)text='🐾 Follow the paws to my bowl';else if(state.nearDog)text='E · Take me to my bowl';else if(Math.hypot(dog.x-state.player.x,dog.y-state.player.y)<3.8)text='Got any food? Please?';else if(dog.whineUntil>state.wing.clock)text='A little snack… please?';
      if(text){c.font='600 10px "DM Sans",sans-serif';const w=c.measureText(text).width+18,x=Math.max(8,Math.min(this.width-w-8,p.x-w/2));c.fillStyle=dog.happy?'#edf4cf':'#fff3db';c.beginPath();c.roundRect(x,top-29,w,23,6);c.fill();c.stroke();c.fillStyle=dog.happy?'#6d8a4b':'#927447';c.fillText(text,x+w/2,top-17);}
      if(dog.happy){c.font='16px "Segoe UI Emoji",sans-serif';c.fillStyle='#d58c86';c.fillText('♥',left+width/2+Math.sin(time/500)*13,top-43-Math.sin(time/250)*3);}c.restore();
    }
    eater(person,state,time) {
      this.guest({...person,color:'#b79668',hair:'#725444',skin:'#d8ae88',snacking:person.status==='eating',snackIcon:person.heldIcon},state,time);
    }
    eaterStatus(state,time) {
      const person=state.wing?.eater;if(Number(this.world.level)!==2||!person)return;
      const eating=person.status==='eating',c=this.ctx,p=this.worldToScreen(person.x,person.y,1.75);
      if(p.x<-100||p.x>this.width+100||p.y<-60||p.y>this.height+100)return;
      const text=eating?`${person.heldIcon||'🍪'} Mmm… crunch crunch!`:person.activated?'NICO · SNACKING LAP':'NICO · TAKING A BREATHER';
      c.save();c.font=`${eating?'700 11':'600 9'}px "DM Sans",sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const w=c.measureText(text).width+22,h=eating?28:22,left=Math.max(8,Math.min(this.width-w-8,p.x-w/2)),top=Math.max(8,p.y-h-7);
      c.fillStyle=eating?'#fff3cd':'#f5e9d5';c.strokeStyle='#b59a75';c.lineWidth=1;c.beginPath();c.roundRect(left,top,w,h,eating?14:5);c.fill();c.stroke();
      if(eating)for(const [dx,dy,r]of[[-5,5,3],[-11,12,1.8]]){c.beginPath();c.arc(p.x+dx,top+h+dy,r,0,Math.PI*2);c.fill();c.stroke();}
      c.fillStyle='#7e592e';c.fillText(text,left+w/2,top+h/2);c.restore();
    }
    stairsMarker(state,time) {
      const stair=this.floorData()?.stair;
      if(!stair)return;
      const upper=stair.direction==='down',c=this.ctx,p=this.worldToScreen(stair.x,stair.y,.085),u=this.unit;
      const pulse=state.paused ? .2 : Math.sin(time/550)*.5+.5;
      c.save();c.strokeStyle=state.nearStairs?'#e4b76c':'rgba(158,123,92,.6)';c.lineWidth=state.nearStairs?2:1.2;c.setLineDash([4,4]);
      c.beginPath();c.ellipse(p.x,p.y,.32*u,.16*u,0,0,Math.PI*2);c.stroke();c.setLineDash([]);
      const arrow=this.worldToScreen(stair.x,stair.y,.38),rise=upper?-1:1;
      c.strokeStyle='#72554f';c.lineWidth=2;c.beginPath();c.moveTo(arrow.x-10,arrow.y+rise*4);c.lineTo(arrow.x+9,arrow.y-rise*4);c.lineTo(arrow.x+3,arrow.y-rise*5);c.moveTo(arrow.x+9,arrow.y-rise*4);c.lineTo(arrow.x+6,arrow.y+rise*1);c.stroke();
      const text=upper?'↓ SNACK & PAWS · WAFFLES':'↑ UPSTAIRS · MORE MUNCHIES';
      c.font=`700 ${Math.max(8,Math.min(10,this.unit*.42))}px "Space Grotesk", sans-serif`;c.textAlign='center';c.textBaseline='middle';
      const width=Math.min(this.width-24,c.measureText(text).width+18),height=22,left=Math.max(12,Math.min(this.width-width-12,p.x-width/2)),top=Math.min(this.height-68,p.y+u*.48+9);
      c.fillStyle=state.nearStairs?'#f4dbab':'rgba(247,236,214,.94)';c.strokeStyle='#b18c66';c.lineWidth=.8;
      c.shadowColor=`rgba(206,161,96,${.1+pulse*.12})`;c.shadowBlur=8;c.beginPath();c.roundRect(left,top,width,height,5);c.fill();c.stroke();c.shadowBlur=0;
      c.fillStyle='#72554f';c.fillText(text,left+width/2,top+height/2+.3,width-14);c.restore();
    }
    environment() {
      const c=this.ctx;
      if(Number(this.world.level)===3) {
        this.plane(-7,-7,44,38,-.8,'#566d81',null);
        this.plane(-4,23,38,12,-.76,'#455d70',null);
        for(let i=0;i<12;i++) {
          const x=-4+i*3.4,y=-4,z=1.2+(i*7%5)*.45;
          this.box(x,y,2.7,1.6,z,i%2?'#3d536a':'#455c71',-.75);
          for(let a=.5;a<2.5;a+=.8)this.line(x+a,y+1.61,.2,x+a,y+1.61,z-.2,'#c3bb93',.8);
        }
        for(const [x,y,size] of [[-4,17,1.1],[33,19,.9],[-1,28,1.1],[29,28,.9]])this.ellipse(x,y,-.3,1.7*size,.8*size,'#496c70',null);
        const p=this.worldToScreen(26,-5,7),u=this.unit;
        c.save();c.shadowColor='#dbe7d6';c.shadowBlur=u*.9;c.fillStyle='#e4e9cf';c.beginPath();c.arc(p.x,p.y,u*.55,0,Math.PI*2);c.fill();c.restore();
        return;
      }
      if(Number(this.world.level)===1) {
        // A cool evening haze and treetops establish the upper-storey view.
        this.plane(-7,-7,44,38,-.8,'#9b9eb0',null);
        this.plane(-4,23,38,12,-.76,'#9098a9',null);
        for(const [x,y,size] of [[-4,3,1.1],[-3,18,.9],[33,4,1.15],[33,20,1],[-1,28,1.1],[29,28,.9]]) {
          this.ellipse(x,y,-.6,1.8*size,.88*size,'#7e8e91',null);
          this.ellipse(x-.25,y,-.3,1.4*size,.7*size,'#899c99',null);
        }
        return;
      }
      // The estate sits in real grounds, rather than floating inside a page card.
      this.plane(-7,-7,44,38,-.8,'#b2bf9f',null);
      this.plane(12.7,22.4,4.6,16,-.72,'#c9c9ab','#9da889',1);
      this.plane(13,22.4,4,16,-.71,'#dbd4b4',null);
      for(let y=24;y<38;y+=1.5)this.line(13,y,-.7,17,y,-.7,'#bbbd9d',.7);
      this.plane(-7,24.8,44,2.2,-.73,'#c6c8a9',null);
      // Low hedges and a few taller trees give the camera something to reveal.
      const hedge=(x,y,w,h)=>{
        this.ellipse(x+w/2,y+h/2,-.7,w*.7,h*.45,'rgba(65,83,51,.15)');
        this.box(x,y,w,h,-.1,'#86996a',-.73,'#70845c');
        for(let t=.25;t<w;t+=.8)this.ellipse(x+t,y+h*.5,-.02,.7,.36,'#91a575','#70865b',.5);
      };
      hedge(-3.1,2,1,18);hedge(32.1,2,1,18);hedge(-2.5,-2.8,34,1);
      for(const [x,y,size] of [[-4.2,3,1.1],[-4,18,.9],[33,4,1.15],[33,20,1],[-1,28,1.1],[29,28,.9]]){
        this.ellipse(x,y,-.74,1.5*size,.7*size,'rgba(59,79,43,.18)');
        this.box(x-.16,y-.16,.32,.32,1.3*size,'#887954',-.7);
        this.ellipse(x,y,1.7*size,1.7*size,.85*size,'#6f8757','#61794c',.7);
        this.ellipse(x-.25,y,2.5*size,1.4*size,.8*size,'#839b65','#6b8354',.6);
        this.ellipse(x+.2,y-.15,3.2*size,.95*size,.65*size,'#96aa76',null);
      }
      for(let i=0;i<33;i++){
        const x=-6+(i*7.7)%43,y=24+(i*3.9)%12;
        if(x>11.8&&x<18)continue;
        this.line(x,y,-.72,x+.12,y, -.49,'#8fa175',.8);this.line(x+.12,y,-.72,x+.3,y+.08,-.55,'#9aad80',.8);
      }
    }
    destination(point,time) {
      if(!point)return;
      const p=this.worldToScreen(point.x,point.y,.09),c=this.ctx,pulse=Math.sin(time/170)*.5+.5;
      c.save();c.strokeStyle='rgba(70,99,54,.55)';c.lineWidth=1.5;c.setLineDash([2,3]);
      c.beginPath();c.ellipse(p.x,p.y,10+pulse*3,5+pulse*1.5,0,0,Math.PI*2);c.stroke();c.setLineDash([]);
      c.fillStyle='#6c854f';c.beginPath();c.ellipse(p.x,p.y,2,1,0,0,Math.PI*2);c.fill();c.restore();
    }
    interaction(state) {
      if(state.paused||state.won||state.failed||state.conversation)return;
      // Dog actions sit above his meter; the toy action sits on its own mat.
      if(state.nearDog||state.nearToy)return;
      const ending=state.homeAvailable&&state.nearHome&&Number(this.world.level)===this.world.home?.level;
      if(!state.nearDog&&!state.nearbySnack&&!state.nearDoor&&!state.nearStairs&&!ending)return;
      const c=this.ctx,p=this.worldToScreen(state.player.x,state.player.y,2.7);
      const door=(this.floorData()?.doors||[]).find(value=>Math.hypot(state.player.x-value.x,state.player.y-value.y)<=value.radius);
      let text=state.nearbySnack?`${state.nearbySnack.icon||'✦'} Bag ${state.nearbySnack.name}`:state.nearDoor?door?.label||'Through doorway':state.nearStairs?(this.floorData()?.stair?.direction==='up'?'Upstairs · More munchies':'Downstairs · Waffles clubhouse'):'End run · Couch & TV';
      c.save();c.font='500 12px "DM Sans", sans-serif';c.textBaseline='middle';c.textAlign='left';
      const maxWidth=Math.min(280,this.width-40);
      while(c.measureText(text).width>maxWidth-52&&text.length>7)text=text.slice(0,-2);
      const width=Math.min(maxWidth,c.measureText(text).width+53),height=34,left=Math.max(12,Math.min(this.width-width-12,p.x-width/2)),top=Math.max(102,p.y-16);
      c.shadowColor='rgba(25,40,20,.16)';c.shadowBlur=14;c.shadowOffsetY=3;c.fillStyle='#354c35';
      c.beginPath();c.roundRect(left,top,width,height,8);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;
      c.fillStyle='#d9ed84';c.beginPath();c.roundRect(left+6,top+6,22,22,4);c.fill();
      c.fillStyle='#36482c';c.font='700 11px "DM Sans", sans-serif';c.fillText('E',left+13,top+17);
      c.fillStyle='#f6f8e8';c.font='500 12px "DM Sans", sans-serif';c.fillText(text,left+36,top+17);
      c.beginPath();c.moveTo(p.x-4,top+height);c.lineTo(p.x,top+height+5);c.lineTo(p.x+4,top+height);c.fillStyle='#354c35';c.fill();c.restore();
    }
    energyFeedback(state,time) {
      const c=this.ctx,energy=Number(state.energy);
      // Green creeps across the world below half energy, with stronger edges.
      // Smooth onset avoids a sudden change at 50%; the HUD stays readable.
      if(Number.isFinite(energy)&&energy<50&&!state.won) {
        const severity=Math.max(0,Math.min(1,(50-energy)/50));
        const strength=severity*severity*(3-2*severity);
        const radius=Math.hypot(this.width,this.height)*.5;
        const tint=c.createRadialGradient(this.width*.5,this.height*.5,0,this.width*.5,this.height*.5,radius);
        tint.addColorStop(0,`rgba(66,133,43,${(strength*.24).toFixed(3)})`);
        tint.addColorStop(1,`rgba(38,110,35,${(strength*.6).toFixed(3)})`);
        c.save();c.fillStyle=tint;c.fillRect(0,0,this.width,this.height);c.restore();
      }
      if(!(state.refillFlash>time)||state.failed)return;
      const remaining=Math.min(1400,state.refillFlash-time),progress=1-remaining/1400;
      const p=this.worldToScreen(state.player.x,state.player.y,3.1);
      const amount=Math.max(0,Math.round(Number(state.refillAmount)||0));
      const text=amount?`+${amount} ENERGY`:'FUELED UP';
      c.save();c.globalAlpha=Math.min(1,remaining/250);c.font='700 12px "Space Grotesk", sans-serif';c.textAlign='center';c.textBaseline='middle';
      const width=c.measureText(text).width+24,left=Math.max(8,Math.min(this.width-width-8,p.x-width/2)),top=Math.max(96,p.y-16-progress*20);
      c.fillStyle='#e4f0bc';c.strokeStyle='#75954d';c.lineWidth=1;c.shadowColor='rgba(42,65,29,.15)';c.shadowBlur=9;c.shadowOffsetY=3;
      c.beginPath();c.roundRect(left,top,width,26,7);c.fill();c.stroke();c.shadowBlur=0;c.shadowOffsetY=0;c.fillStyle='#486d32';c.fillText(text,left+width/2,top+13);
      c.restore();
    }
    drawArchitecture() {
      const c=this.ctx,upper=Number(this.world.level)===1,wing=Number(this.world.level)===2,midnight=Number(this.world.level)===3;
      this.environment();
      // A soft grounded shadow and a bevel make the whole house feel like a miniature.
      c.save();c.shadowColor='rgba(68,72,45,.19)';c.shadowBlur=28;c.shadowOffsetY=16;this.plane(-.25,-.25,30.5,22.5,-.55,midnight?'#53667b':upper?'#8c899e':'#a5ab8e',null);c.restore();
      this.box(-.2,-.2,30.4,22.4,0,midnight?'#88949f':upper?'#aaa0b2':'#c4c3a3',-.6);
      this.plane(0,0,30,22,.01,midnight?'#a1a8b6':upper?'#c3b4c1':'#dfd5b4',INK,1.2);
      // Connecting corridors: travertine with a muted inlay.
      for(let x=0;x<30;x+=1)for(let y=0;y<22;y+=1)if(wing?(x>=13&&x<16||y>=9&&y<12&&x<16):(x>=9&&x<11||x>=19&&x<21||y>=10&&y<12))this.plane(x,y,1,1,.015,midnight?((x+y)%2?'#a3aaba':'#b8b6c6'):upper?((x+y)%2?'#c0b2c2':'#d5c6ce'):((x+y)%2?'#ded9bf':'#e8e0c5'),'rgba(116,120,88,.15)',.45);
      this.world.rooms.forEach(r=>this.floor(r));
      // Full rear walls; open front gives an unobstructed dollhouse view.
      for(const wall of this.doorWallSegments({x:0,y:0,w:30,h:.2}))this.box(wall.x,wall.y,wall.w,wall.h,1.8,midnight?'#c3bdcd':upper?'#c8b8c8':'#ded8b7');
      for(const wall of this.doorWallSegments({x:0,y:0,w:.2,h:midnight?12:22}))this.box(wall.x,wall.y,wall.w,wall.h,1.8,midnight?'#b0b8c2':upper?'#bfb4c5':'#dad5b5');
      for(const wall of this.doorWallSegments({x:0,y:0,w:30,h:.24}))this.box(wall.x,wall.y,wall.w,wall.h,1.92,midnight?'#d9d1dd':upper?'#e9d3da':'#f2e8c8',1.8);
      for(const wall of this.doorWallSegments({x:0,y:0,w:.24,h:midnight?12:22}))this.box(wall.x,wall.y,wall.w,wall.h,1.92,midnight?'#d9d1dd':upper?'#e9d3da':'#f2e8c8',1.8);
      // Wall panelling and windows add detail to the silhouette.
      for(let x=2;x<29;x+=3.3) {
        this.poly([this.worldToScreen(x,.22,.45),this.worldToScreen(x+1.65,.22,.45),this.worldToScreen(x+1.65,.22,1.5),this.worldToScreen(x,.22,1.5)],midnight?'#4a657d':upper?'#858cae':'#8ca395',upper?'#686580':'#596f5c',1);
        this.line(x+.825,.23,.45,x+.825,.23,1.5,'#e6dfba',1.3);this.line(x,.23,.95,x+1.65,.23,.95,'#e6dfba',1.3);
      }
      for(let y=2;y<(midnight?11:21);y+=3.2){
        if((this.floorData()?.doors||[]).some(door=>door.orientation==='west'&&y+2>(door.anchor?.y??door.y)-(door.openingWidth||2.4)*.5&&y<(door.anchor?.y??door.y)+(door.openingWidth||2.4)*.5))continue;
        this.line(.22,y,.15,.22,y,1.6,'#bbb997',1);this.line(.23,y,.4,.23,y+2,.4,'#bbb997',.8);
      }
      if(midnight) {
        // The terrace is open to the night, edged by a low metal balustrade.
        for(let y=12.5;y<21;y+=1.1)this.line(.95,y,.1,.95,y,1.05,'#8ca3ad',1.1);
        this.line(.95,12,.98,.95,21,.98,'#b7c5c5',2);
        for(let x=1.4;x<20.9;x+=1.1)this.line(x,20.95,.1,x,20.95,.55,'#718990',.8);
        this.line(1,20.95,.56,20.9,20.95,.56,'#a7bcbc',1.5);
        for(const [x,y] of [[15,12.8],[15,14.4],[16.5,16.5],[18.2,16.5],[20,16.5]])this.ellipse(x,y,.055,.12,.06,'#eddbad');
      }
      // Low interior partitions retain the floor plan without hiding collectables.
      const walls=this.world.walls||[];
      walls.flatMap(w=>this.doorWallSegments(w)).forEach(w=>{
        if(w.x<.4||w.y<.4||w.x>29.5||w.y>21.5)return;
        const hh=(w.w>w.h)?.45:.62;
        this.box(w.x,w.y,w.w,w.h,hh,midnight?'#aab0bf':upper?'#bfb1c4':'#d5d2af');
        this.plane(w.x-.025,w.y-.025,w.w+.05,w.h+.05,hh+.04,midnight?'#d8cdd8':upper?'#e7ccd7':'#f0e4c1',INK,.6);
      });
      // Decorative rugs sit below the rest of the furniture.
      this.rugs.forEach(f=>this.drawFurniture(f));
      this.wingWayfinding();
      this.stairsGeometry();
      this.doorGeometry();
    }
    draw(state,time=0) {
      const c=this.ctx;
      const ending=state.ending&&Number(this.world.level)===this.world.home?.level,seated=ending&&(state.ending.seated||Number(state.ending.elapsed)>=1.3);
      let player=state.player;
      if(ending)player=this.endingPose(state,time);
      else{this.endingShot=null;this.updateCamera(state.player,time);}
      c.setTransform(this.dpr,0,0,this.dpr,0,0);c.lineJoin='round';c.lineCap='round';
      this.drawBackdrop();
      this.drawArchitectureCached();
      if(!ending)this.stealthFloor(state,time);
      if(!ending){this.homeZone(state,time);this.destination(state.destination,time);}
      // Solid scenery, guests and the player share depth ordering. Snack glyphs are a
      // separate discovery overlay, so tall shelves cannot erase a hiding spot.
      const level=Number(this.world.level)||0;
      const seatSofa=seated?this.endingShot.sofa:null;
      const playerDepth=seatSofa?seatSofa.x+seatSofa.y+(seatSofa.w+seatSofa.h)*.5+.02:player.x+player.y+.1;
      const actors=[{player:true,item:player,depth:playerDepth}];
      for(const guest of state.guests||[])if((Number(guest.level)||0)===level)actors.push({item:guest,depth:guest.x+guest.y+.1});
      const resident=state.stealth?.resident;
      if(!ending&&level===Number(this.world.midnight?.level??3)&&resident&&resident.status!=='sleeping'&&Number(resident.level)===level&&this.world.getRoom(resident.x,resident.y,level)?.id!==this.world.home?.room)actors.push({resident:true,item:resident,depth:resident.x+resident.y+.1});
      const dog=state.wing?.dog;
      if(dog&&Number(dog.level)===level){const pose=ending?this.endingDogPose(state,time,player):dog;if(pose)actors.push({dog:true,item:pose,depth:Number.isFinite(pose.painterDepth)?pose.painterDepth:pose.x+pose.y+.08});}
      if(level===2&&state.wing){const {eater}=state.wing;actors.push({eater:true,item:eater,depth:eater.x+eater.y+.1});const toy=this.world.wing?.toy;if(toy)actors.push({toy:true,item:toy,depth:toy.x+toy.y+.08});this.dogBowl(state,time);}
      actors.sort((a,b)=>a.depth-b.depth);
      let nextActor=0;
      const drawActor=actor=>actor.player?(seated?this.seatedAvatar(actor.item,state,time):this.avatar(actor.item,time)):actor.dog?this.corgi(actor.item,state,time):actor.eater?this.eater(actor.item,state,time):actor.toy?this.toyStation(state,time):actor.resident?this.resident(actor.item,state,time):this.guest(actor.item,state,time);
      for(const entity of this.furniture) {
        while(nextActor<actors.length&&entity.depth>actors[nextActor].depth)drawActor(actors[nextActor++]);
        this.drawFurnitureCached(entity.item);
        this.televisionVideo(entity.item,state,time);
      }
      while(nextActor<actors.length)drawActor(actors[nextActor++]);
      if(!ending){this.world.rooms.forEach(r=>this.roomLabel(r,state.activeRoom===r.id,state));this.homeMarker(state);this.stairsMarker(state,time);this.doorMarkers(state,time);}
      // The front steps and path tie the miniature to its surrounding surface.
      if(!level||level===2) {
        this.box(13.5,22.08,3,.65,-.12,'#d8d0af',-.48);
        this.box(13.7,22.62,2.6,.5,-.35,'#dad3b8',-.61);
        this.frontPlanters.forEach(item=>this.drawFurnitureCached(item));
      } else {
        this.box(.5,22.05,29,.12,.58,'#b69caf',.47);
        for(let x=.6;x<30;x+=1.5)this.box(x,22.05,.08,.12,.5,'#a48caa',.04);
      }
      c.save();c.globalAlpha=.55;c.font='600 8px "Space Grotesk", sans-serif';c.fillStyle=level===1?'#615c79':'#657053';c.textAlign='center';const p=this.worldToScreen(15,24.2,-.2);c.fillText(level===2?'THE GOOD LIFE ESTATE · SNACK & PAWS':level?'THE GOOD LIFE ESTATE · AFTER HOURS':'THE GOOD LIFE ESTATE',p.x,p.y);c.restore();
      // Keep z=1.04 in snack() aligned with the application's click hit targets.
      if(!ending){
        (this.world.snacks||[]).forEach(snack=>this.snack(snack,state,time));
        this.interaction(state);this.energyFeedback(state,time);this.dogStatus(state,time);this.eaterStatus(state,time);this.toyMarker(state);this.stealthStatus(state,time);this.guestSpeech(state,time);
      }
    }
  }
  window.MansionRenderer=MansionRenderer;
})();
