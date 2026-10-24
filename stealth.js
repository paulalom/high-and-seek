/* Midnight noise and a sleepy resident. Only the player's actions make noise. */
(() => {
  'use strict';
  const STEP = .5, RADIUS = .26, DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function create(world) {
    const runtime = {}, area = () => world.midnight?.level ?? 3;
    let grid = null, path = [], events = [], cooldowns = new Map(), routeAge = Infinity, heardAt = -Infinity, warningArmed = true, previousTarget = null;
    const surfaces = [
      { id: 'laundry-mask', type: 'mask', room: 'laundry', x: 1.2, y: 1.2, w: 7.4, h: 5, label: 'Spinning washers mask noise', active: true },
      { id: 'wardrobe-rug', type: 'quiet', room: 'wardrobe', x: 14, y: 3.2, w: 2.8, h: 5.5, label: 'Soft rug · quiet footsteps' },
      { id: 'attic-creak-middle', type: 'creak', room: 'attic', x: 24, y: 3.2, w: 1.4, h: 2.8, label: 'Creaky floorboards' },
      { id: 'attic-creak-door', type: 'creak', room: 'attic', x: 24.1, y: 8.1, w: 3.4, h: 1.4, label: 'Creaky floorboards' },
      { id: 'terrace-bottles', type: 'clink', room: 'terrace', x: 13.5, y: 15.8, w: 2.4, h: 1.5, label: 'Loose bottles · watch your step' }
    ];
    function emit(type, detail = {}) { events.push({ type, ...detail }); if (events.length > 32) events.shift(); }
    function roomAt(point) { return world.getRoom(point.x, point.y, area()); }
    function inside(rect, point, margin = 0) { return point.x >= rect.x - margin && point.x <= rect.x + rect.w + margin && point.y >= rect.y - margin && point.y <= rect.y + rect.h + margin; }
    function safeRoom() { return world.home?.level === area() ? world.floors.find(floor => floor.id === area())?.rooms.find(room => room.id === world.home.room) : null; }
    function safe(point, margin = 0) { const snug = safeRoom(); return !!snug && inside(snug, point, margin); }
    function walkable(point, radius = RADIUS) { return world.isWalkable(point.x, point.y, radius, area()) && !safe(point, radius); }
    function clearLine(a, b, radius = RADIUS, avoidSnug = true) {
      const count = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y) / .075));
      for (let i=0;i<=count;i++) {
        const point = { x: a.x + (b.x-a.x)*i/count, y: a.y + (b.y-a.y)*i/count };
        if (!world.isWalkable(point.x, point.y, radius, area()) || avoidSnug && safe(point, radius)) return false;
      }
      return true;
    }
    function point(index) { return { x: grid.x[index], y: grid.y[index] }; }
    function buildGrid() {
      if (grid) return;
      const floor = world.floors.find(item => item.id === area()), cols = Math.round((floor?.width ?? world.width)/STEP)+1, rows = Math.round((floor?.height ?? world.height)/STEP)+1, size = cols*rows;
      grid = { cols, rows, x:new Float32Array(size), y:new Float32Array(size), open:new Uint8Array(size), edges:new Uint8Array(size), previous:new Int32Array(size), queue:new Int32Array(size), cells:[] };
      for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
        const i=y*cols+x; grid.x[i]=x*STEP; grid.y[i]=y*STEP;
        if (walkable(point(i))) { grid.open[i]=1; grid.cells.push(i); }
      }
      for (const i of grid.cells) for (let d=0;d<DIRECTIONS.length;d++) {
        const [dx,dy]=DIRECTIONS[d], x=i%cols+dx, y=Math.floor(i/cols)+dy, next=y*cols+x;
        if (x>=0&&y>=0&&x<cols&&y<rows&&grid.open[next]&&clearLine(point(i),point(next))) grid.edges[i]|=1<<d;
      }
      runtime.stats.pathBuilds++;
    }
    function route(actor, target) {
      runtime.stats.pathQueries++;
      if (clearLine(actor,target)) return [{ x:target.x, y:target.y }];
      buildGrid();
      let start=-1, distance=Infinity;
      const cx=Math.round(actor.x/STEP),cy=Math.round(actor.y/STEP);
      for(let y=Math.max(0,cy-4);y<=Math.min(grid.rows-1,cy+4);y++)for(let x=Math.max(0,cx-4);x<=Math.min(grid.cols-1,cx+4);x++) {
        const i=y*grid.cols+x, gap=(grid.x[i]-actor.x)**2+(grid.y[i]-actor.y)**2;
        if(grid.open[i]&&gap<distance&&clearLine(actor,point(i))){distance=gap;start=i;}
      }
      if(start<0)return [];
      const previous=grid.previous,queue=grid.queue;previous.fill(-1);previous[start]=start;queue[0]=start;
      let tail=1, goal=start, closest=Infinity;
      for(let head=0;head<tail;head++) {
        const i=queue[head], gap=Math.hypot(grid.x[i]-target.x,grid.y[i]-target.y);
        if(gap<closest){closest=gap;goal=i;}
        if(gap<=.45){goal=i;break;}
        for(let d=0;d<DIRECTIONS.length;d++)if(grid.edges[i]&(1<<d)) {
          const [dx,dy]=DIRECTIONS[d],next=i+dy*grid.cols+dx;
          if(previous[next]>=0)continue;previous[next]=i;queue[tail++]=next;
        }
      }
      if(closest>1)return [];
      const result=[];for(let i=goal;i!==start;i=previous[i])result.push(point(i));result.push(point(start));result.reverse();
      if(clearLine(result[result.length-1],target))result.push({x:target.x,y:target.y});
      return result;
    }
    function follow(target, dt) {
      const resident=runtime.resident;
      routeAge+=dt;
      if(routeAge>=.35&&(!previousTarget||Math.hypot(previousTarget.x-target.x,previousTarget.y-target.y)>.3||!path.length)) {
        path=route(resident,target);routeAge=0;previousTarget={...target};
      }
      const before={x:resident.x,y:resident.y};let budget=2.6*Math.min(1,dt);
      for(let guard=0;path.length&&budget>.0001&&guard<100;guard++) {
        const next=path[0],dx=next.x-resident.x,dy=next.y-resident.y,gap=Math.hypot(dx,dy);
        if(gap<.055){path.shift();continue;}
        const stride=Math.min(.075,budget,gap),moved=world.moveCircle(resident.x,resident.y,dx/gap*stride,dy/gap*stride,RADIUS,area());
        if(moved.distance<.0001||!walkable(moved)||!clearLine(resident,moved))break;
        resident.x=moved.x;resident.y=moved.y;budget-=moved.distance;
      }
      resident.moving=Math.hypot(resident.x-before.x,resident.y-before.y)>.001;
      if(resident.moving)resident.facing=resident.x-before.x-(resident.y-before.y)>=0?1:-1;
      return Math.hypot(resident.x-target.x,resident.y-target.y);
    }
    function spawnPoint() {
      for(const candidate of [{x:27,y:8.8},{x:27,y:9},{x:18,y:11},{x:25,y:8.5},{x:15,y:11}])if(walkable(candidate))return candidate;
      const floor=world.floors.find(item=>item.id===area());
      for(let y=1.5;y<(floor?.height??world.height)-1;y+=.5)for(let x=1.5;x<(floor?.width??world.width)-1;x+=.5)if(walkable({x,y}))return {x,y};
      return {x:15,y:11};
    }
    function reset() {
      const home=spawnPoint();
      Object.assign(runtime,{noise:0,mode:'quiet',clock:0,masking:false,label:'Keep the house asleep',safe:false,lastNoise:null,rippleUntil:0,surfaces,stats:{pathBuilds:0,pathQueries:0},resident:{id:'nightResident',name:'Mara',level:area(),x:home.x,y:home.y,home:{...home},moving:false,facing:1,status:'sleeping',sleeping:true,target:null,searchRemaining:0,cooldown:0,voiceId:'houseGuest',lines:[
        'Do you know what time it is? Some of us are trying to have an extremely sensible bedtime.',
        'Every cupboard in this house has a quiet setting. The quiet setting is leaving it alone.',
        'Take your snacks, use your inside footsteps, and please let the house get some sleep.'
      ]}});
      grid=null;path=[];events=[];cooldowns=new Map();routeAge=Infinity;heardAt=-Infinity;warningArmed=true;previousTarget=null;
      surfaces[0].active=true;
      return runtime;
    }
    function active(state) { return state.level===area()&&state.started&&!state.paused&&!state.won&&!state.failed&&!state.hidden&&!(typeof document!=='undefined'&&document.hidden); }
    function context(state) {
      const player=state.player,room=roomAt(player)?.id;
      surfaces[0].active=runtime.clock%12<6;
      const wash=room==='laundry'&&surfaces[0].active&&inside(surfaces[0],player),wind=room==='terrace'&&runtime.clock%14>=9&&runtime.clock%14<12;
      const rug=surfaces.find(surface=>surface.type==='quiet'&&inside(surface,player));
      runtime.masking=wash||wind;
      runtime.label=safe(player)?'SAFE · TV snug':wash?'Washers cover your noise':wind?'Wind covers your noise':rug?'Soft rug · quiet steps':runtime.mode==='scolding'?'Six seconds of shushing':runtime.mode==='cooldown'?'Mara is heading back to bed':runtime.mode==='searching'?'Stay quiet. She is searching.':runtime.mode==='investigating'?'Mara heard something…':runtime.mode==='warning'?'Careful. Someone is stirring.':'Keep the house asleep';
      return {factor:wash ? .3 : wind ? .4 : 1,movement:rug ? .35 : 1,room};
    }
    function retreat(seconds=8) {
      const resident=runtime.resident;
      runtime.mode='cooldown';resident.status='returning';resident.sleeping=false;resident.cooldown=Math.max(seconds,resident.cooldown);resident.target={...resident.home};resident.searchRemaining=0;
      path=[];routeAge=Infinity;previousTarget=null;
    }
    function addNoise(amount,kind,state) {
      if(!active(state)||safe(state.player)||runtime.mode==='scolding')return false;
      const requested=Number(amount);if(!Number.isFinite(requested)||requested<=0)return false;
      const settings=context(state),addition=requested*settings.factor;
      if(!addition)return false;
      runtime.noise=clamp(runtime.noise+addition,0,100);
      runtime.lastNoise={x:state.player.x,y:state.player.y,kind,amount:addition,at:runtime.clock};
      if(addition>=8||kind==='creak'||kind==='clink')runtime.rippleUntil=runtime.clock+.8;
      if(runtime.noise>=50&&warningArmed&&['quiet','warning'].includes(runtime.mode)){warningArmed=false;emit('warning',{noise:runtime.noise});}
      if((runtime.mode==='quiet'||runtime.mode==='warning')&&runtime.noise>=85) {
        runtime.mode='investigating';runtime.resident.sleeping=false;runtime.resident.status='investigating';runtime.resident.target={x:state.player.x,y:state.player.y};runtime.resident.searchRemaining=0;
        routeAge=Infinity;path=[];previousTarget=null;heardAt=runtime.clock;emit('alarm',{x:state.player.x,y:state.player.y});
      } else if(['investigating','searching'].includes(runtime.mode)&&runtime.clock-heardAt>=.35&&(addition>=8||kind==='sprint')) {
        runtime.resident.target={x:state.player.x,y:state.player.y};runtime.resident.status='investigating';runtime.mode='investigating';runtime.resident.searchRemaining=0;heardAt=runtime.clock;routeAge=Infinity;
      }
      if(runtime.mode==='quiet'&&runtime.noise>=50)runtime.mode='warning';
      return true;
    }
    function makeNoise(kind,state) {
      if(!active(state)||safe(state.player))return false;
      if(typeof kind==='number')return addNoise(kind,'noise',state);
      const amount=kind==='rummage'?22:kind==='bump'?12:0,wait=kind==='bump'?.9:.12;
      if(!amount||runtime.clock<(cooldowns.get(kind)??-Infinity))return false;
      cooldowns.set(kind,runtime.clock+wait);return addNoise(amount,kind,state);
    }
    function update(dt,state,activity={}) {
      if(!active(state))return;
      const seconds=Number(dt);if(!Number.isFinite(seconds)||seconds<=0)return;
      runtime.clock+=seconds;runtime.safe=safe(state.player);const resident=runtime.resident;resident.moving=false;
      context(state);
      if(runtime.safe) {
        runtime.noise=0;warningArmed=true;
        if(['investigating','searching'].includes(runtime.mode))retreat();
      } else if(runtime.mode!=='scolding') {
        const settings=context(state),distance=Number.isFinite(Number(activity.distance))?Math.max(0,Number(activity.distance)):0;
        if(distance>0){
          addNoise(distance*(activity.sprinting?10:2)*settings.movement,activity.sprinting?'sprint':'footsteps',state);
          const surface=surfaces.find(surface=>['creak','clink'].includes(surface.type)&&inside(surface,state.player));
          if(surface&&runtime.clock>=(cooldowns.get(surface.id)??-Infinity)){cooldowns.set(surface.id,runtime.clock+.65);addNoise(surface.type==='creak'?12:14,surface.type,state);}
        }
        runtime.noise=Math.max(0,runtime.noise-6*seconds);
      }
      if(runtime.noise<35)warningArmed=true;
      if(runtime.mode==='warning'&&runtime.noise<35){runtime.mode='quiet';emit('quiet');}
      if(runtime.mode==='scolding'){resident.status='scolding';context(state);return;}
      if(runtime.mode==='cooldown') {
        resident.cooldown=Math.max(0,resident.cooldown-seconds);runtime.noise=Math.min(65,runtime.noise);
        const gap=follow(resident.home,seconds);
        if(gap<=.55&&resident.cooldown<=0){resident.status='sleeping';resident.sleeping=true;resident.target=null;resident.moving=false;runtime.mode=runtime.noise>=50?'warning':'quiet';path=[];emit('quiet');}
        context(state);return;
      }
      if(!['investigating','searching'].includes(runtime.mode)){resident.status='sleeping';resident.sleeping=true;context(state);return;}
      const gap=Math.hypot(state.player.x-resident.x,state.player.y-resident.y);
      const sees=!runtime.safe&&gap<=5&&clearLine(resident,state.player,.06,false);
      if(sees) {
        resident.target={x:state.player.x,y:state.player.y};resident.searchRemaining=0;resident.status='investigating';runtime.mode='investigating';
        if(gap<=1.1){runtime.mode='scolding';resident.status='scolding';resident.moving=false;path=[];emit('caught',{residentId:resident.id,name:resident.name,voiceId:resident.voiceId,lines:[...resident.lines],duration:6});context(state);return;}
      }
      if(resident.target&&runtime.mode==='investigating') {
        const remaining=follow(resident.target,seconds);
        if(remaining<=.6&&runtime.mode==='investigating'&&!sees){runtime.mode='searching';resident.status='searching';resident.searchRemaining=5;path=[];}
      }
      if(runtime.mode==='searching') {
        resident.searchRemaining=Math.max(0,resident.searchRemaining-seconds);
        if(resident.searchRemaining<=0){runtime.noise=Math.min(runtime.noise,35);retreat(4);}
      }
      context(state);
    }
    function endLecture(state) {
      if(runtime.mode!=='scolding')return false;
      runtime.noise=safe(state?.player||runtime.resident)?0:25;warningArmed=true;retreat(8);return true;
    }
    function changeFloor(next,_arrival,state) {
      if(next===area()){runtime.safe=!!state?.player&&safe(state.player);context(state||{player:runtime.resident});return;}
      runtime.noise=0;runtime.mode='quiet';runtime.safe=false;runtime.masking=false;runtime.label='Keep the house asleep';runtime.lastNoise=null;runtime.rippleUntil=0;
      Object.assign(runtime.resident,{x:runtime.resident.home.x,y:runtime.resident.home.y,moving:false,status:'sleeping',sleeping:true,target:null,searchRemaining:0,cooldown:0});
      path=[];events=[];routeAge=Infinity;heardAt=-Infinity;previousTarget=null;warningArmed=true;cooldowns.clear();
    }
    reset();
    return {reset,update,makeNoise,changeFloor,endLecture,getState:()=>runtime,drainEvents:()=>events.splice(0)};
  }
  window.HSStealth={create};
})();
