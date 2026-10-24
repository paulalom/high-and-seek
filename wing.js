/* Snack & Paws: a hungry corgi and a guest with a competitive appetite. */
(() => {
  'use strict';
  const STEP = .5, DIRECTIONS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  function create(world) {
    const runtime = {};
    const grids = new Map();
    let grid = null, events = [], dogPath = [], eaterPath = [], dogRouteAge = 0, eaterRouteAge = 0, whineAge = 0, munchAge = 0;
    const config = () => world.wing;
    const level = () => config()?.level ?? 2;
    const point = index => ({ x: index % grid.cols * STEP, y: Math.floor(index / grid.cols) * STEP });
    function emit(type, details = {}) { events.push({ type, ...details }); if (events.length > 32) events.shift(); }
    function clearLine(a, b, radius = .26, area = a.level ?? level()) {
      const count = Math.max(1, Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/.08));
      for (let i=0;i<=count;i++) if (!world.isWalkable(a.x+(b.x-a.x)*i/count,a.y+(b.y-a.y)*i/count,radius,area)) return false;
      return true;
    }
    function buildGrid(area) {
      if (grids.has(area)) { grid = grids.get(area); return; }
      const floor = world.floors.find(item => item.id === area);
      const cols = Math.round((floor?.width ?? world.width)/STEP)+1, rows = Math.round((floor?.height ?? world.height)/STEP)+1, size = cols*rows;
      grid = { cols, rows, open:new Uint8Array(size), edges:new Uint8Array(size), previous:new Int32Array(size), queue:new Int32Array(size), gx:new Float32Array(size),gy:new Float32Array(size),cells:[],candidates:[] };
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) { const i=y*cols+x;grid.gx[i]=x*STEP;grid.gy[i]=y*STEP;if(world.isWalkable(x*STEP,y*STEP,.26,area)) { grid.open[i]=1; grid.cells.push(i); } }
      for(const index of grid.cells) {
        const x=index%cols,y=Math.floor(index/cols);
        for(let d=0;d<8;d++) { const [dx,dy]=DIRECTIONS[d],nx=x+dx,ny=y+dy,ni=ny*cols+nx;
          if(nx<0||ny<0||nx>=cols||ny>=rows||!grid.open[ni])continue;
          if(clearLine(point(index),point(ni),.26,area))grid.edges[index]|=1<<d;
        }
      }
      grids.set(area,grid);
    }
    function closest(actor) {
      const cx=Math.round(actor.x/STEP),cy=Math.round(actor.y/STEP),sorted=grid.candidates;sorted.length=0;
      for(let y=Math.max(0,cy-4);y<=Math.min(grid.rows-1,cy+4);y++)for(let x=Math.max(0,cx-4);x<=Math.min(grid.cols-1,cx+4);x++){const i=y*grid.cols+x;if(grid.open[i])sorted.push(i);}
      sorted.sort((a,b)=>(grid.gx[a]-actor.x)**2+(grid.gy[a]-actor.y)**2-((grid.gx[b]-actor.x)**2+(grid.gy[b]-actor.y)**2));
      return sorted.find(index=>clearLine(actor,point(index),.26,actor.level ?? level())) ?? -1;
    }
    function route(actor,target,within=.15) {
      const area=actor.level ?? level();
      if(clearLine(actor,target,.26,area))return [{x:target.x,y:target.y}];
      buildGrid(area);
      const start=closest(actor);if(start<0)return [];
      const previous=grid.previous,queue=grid.queue;previous.fill(-1);previous[start]=start;queue[0]=start;
      let tail=1,goal=-1,nearest=Infinity;
      for(let head=0;head<tail;head++) {
        const i=queue[head],p=point(i),distance=Math.hypot(p.x-target.x,p.y-target.y);
        if(distance<nearest){nearest=distance;goal=i;}
        if(distance<=within){goal=i;break;}
        for(let d=0;d<8;d++)if(grid.edges[i]&(1<<d)){const [dx,dy]=DIRECTIONS[d],ni=i+dy*grid.cols+dx;if(previous[ni]>=0)continue;previous[ni]=i;queue[tail++]=ni;}
      }
      if(goal<0||nearest>Math.max(.8,within)&&!clearLine(point(goal),target,.26,area))return [];
      const result=[];for(let i=goal;i!==start;i=previous[i])result.push(point(i));result.push(point(start));result.reverse();
      if(clearLine(result[result.length-1],target,.26,area))result.push({x:target.x,y:target.y});
      return result;
    }
    function followPath(actor,path,budget,stop=.05,radius=.25) {
      const startX=actor.x,startY=actor.y;let travelled=0;
      for(let attempts=0;path.length&&budget>.0001&&attempts<100;attempts++) {
        while(path.length&&Math.hypot(path[0].x-actor.x,path[0].y-actor.y)<(path.length===1?.01:.07))path.shift();
        if(!path.length)break;
        const target=path[0],dx=target.x-actor.x,dy=target.y-actor.y,distance=Math.hypot(dx,dy);
        const stride=Math.min(.08,budget,Math.max(0,distance-(path.length===1?stop:0)));
        if(stride<.0001)break;
        const moved=world.moveCircle(actor.x,actor.y,dx/distance*stride,dy/distance*stride,radius,actor.level ?? level());
        actor.x=moved.x;actor.y=moved.y;budget-=Math.min(stride,moved.distance);
        travelled+=moved.distance;
        if(moved.distance<.0001)break;
      }
      actor.moving=Math.hypot(actor.x-startX,actor.y-startY)>.001;
      if(actor.moving)actor.facing=actor.x-startX-(actor.y-startY)>=0?1:-1;
      return travelled;
    }
    function reset() {
      const wing=config()||{},dog=wing.dog||{},eater=wing.eater||{};
      Object.assign(runtime,{clock:0,taskCompleted:false,consumed:new Set(),toy:{used:false,usedAt:0},dog:{...dog,level:level(),x:dog.x??6.5,y:dog.y??16.5,name:dog.name||'Waffles',energy:dog.startEnergy??75,maxEnergy:dog.maxEnergy??100,status:'hungry',following:false,happy:false,sleeping:false,companion:false,moving:false,facing:1,eatTimer:0,whineUntil:0,playUntil:0,distractions:0,distractionReason:null,followedDistance:0,waits:0},eater:{...eater,level:level(),x:eater.x??6,y:eater.y??5,room:world.getRoom(eater.x??6,eater.y??5,level())?.id||'snackerDen',name:eater.name||'Nico',activated:false,status:'wandering',moving:false,facing:1,target:null,eatTimer:0,routeIndex:0,heldIcon:null}});
      events=[];dogPath=[];eaterPath=[];dogRouteAge=Infinity;eaterRouteAge=Infinity;whineAge=0;munchAge=0;grid=null;grids.clear();
      return runtime;
    }
    function playing(state) { return !!config()&&state.started&&!state.paused&&!state.failed&&!state.won; }
    function active(state) { return playing(state)&&state.level===level(); }
    function canInteract(state) {
      const dog=runtime.dog;
      return active(state)&&!dog.happy&&['hungry','sleeping','sniffing','waiting'].includes(dog.status)&&Math.hypot(dog.x-state.player.x,dog.y-state.player.y)<=1.8&&clearLine(dog,state.player,.15);
    }
    function interact(state) {
      if(!canInteract(state))return false;
      const dog=runtime.dog;
      const coaxed=dog.status==='sniffing'||dog.status==='waiting';
      if(dog.sleeping){dog.energy=25;dog.sleeping=false;emit('wake',{name:dog.name});}
      dog.following=true;dog.status='following';dog.distractionReason=null;dogRouteAge=Infinity;
      emit(coaxed?'coaxed':'following',{name:dog.name});return true;
    }
    function canPlay(state) {
      const toy=config()?.toy,dog=runtime.dog;
      return !!toy&&active(state)&&!runtime.taskCompleted&&!runtime.toy.used&&dog.following&&!dog.sleeping&&
        dog.status==='following'&&dog.energy>0&&Math.hypot(dog.x-state.player.x,dog.y-state.player.y)<=3&&
        Math.hypot(state.player.x-toy.x,state.player.y-toy.y)<=toy.radius&&clearLine(dog,state.player,.15);
    }
    function play(state) {
      if(!canPlay(state))return false;
      const toy=config().toy,dog=runtime.dog,before=dog.energy;
      runtime.toy.used=true;runtime.toy.usedAt=runtime.clock;
      dog.energy=Math.min(dog.maxEnergy,dog.energy+toy.energy);dog.playUntil=runtime.clock+2;dog.moving=false;
      dogPath=[];dogRouteAge=Infinity;
      emit('play',{energy:dog.energy-before});return true;
    }
    function changeFloor(area,arrival,state) {
      const dog=runtime.dog;
      if(!runtime.taskCompleted||!dog.happy||!world.floors.some(floor=>floor.id===area)||!arrival)return false;
      const target={x:arrival.x,y:arrival.y,level:area};let spawn=null;
      for(const radius of [.8,.5,1.2,1.6]) {
        for(let i=0;i<16;i++) {
          const candidate={x:target.x+Math.cos(i*Math.PI/8)*radius,y:target.y+Math.sin(i*Math.PI/8)*radius,level:area};
          if(world.isWalkable(candidate.x,candidate.y,.26,area)&&clearLine(candidate,target,.26,area)){spawn=candidate;break;}
        }
        if(spawn)break;
      }
      if(!spawn&&world.isWalkable(target.x,target.y,.26,area))spawn=target;
      if(!spawn)return false;
      Object.assign(dog,spawn,{following:true,companion:true,status:'happy',moving:false,sleeping:false});
      dogPath=[];dogRouteAge=Infinity;
      return true;
    }
    function followDog(movement,state) {
      const dog=runtime.dog,wing=config(),bowl=wing.bowl,gap=Math.hypot(dog.x-state.player.x,dog.y-state.player.y);
      if(!dog.happy&&gap>4.5&&dog.waits<1) {
        dog.waits++;dog.following=false;dog.status='waiting';dog.distractionReason='Little legs! Come back for me.';dogPath=[];
        emit('waiting',{name:dog.name,reason:dog.distractionReason});return;
      }
      if(gap>1.1&&runtime.clock>=dog.playUntil) {
        if(dogRouteAge>=.6){dogPath=route(dog,state.player,.7);dogRouteAge=0;}
        const speed=dog.happy?(gap>4?7.4:5.25):(wing.dog.followSpeed??3.5);
        dog.followedDistance+=followPath(dog,dogPath,speed*movement,.75,.25);
      }
      const pauses=[2.4,5.5,8.5],reasons=['An irresistible smell.','A very important paw check.','One more pep talk, please.'];
      if(!dog.happy&&dog.distractions<pauses.length&&dog.followedDistance>=pauses[dog.distractions]&&(!bowl||Math.hypot(dog.x-bowl.x,dog.y-bowl.y)>2)) {
        dog.distractionReason=reasons[dog.distractions++];dog.following=false;dog.status='sniffing';dog.moving=false;dogPath=[];
        emit('distracted',{name:dog.name,reason:dog.distractionReason,distractions:dog.distractions});
      }
    }
    function update(dt,state) {
      if(!playing(state))return;
      const seconds=Math.max(0,Number(dt)||0);if(!Number.isFinite(seconds)||!seconds)return;
      const movement=Math.min(seconds,1),wing=config(),dog=runtime.dog,eater=runtime.eater,bowl=wing.bowl;
      const inWing=state.level===level(),withDog=state.level===dog.level;
      if(!inWing&&!(withDog&&dog.happy))return;
      runtime.clock+=seconds;dogRouteAge+=seconds;
      if(withDog)dog.moving=false;
      if(withDog&&dog.happy)followDog(movement,state);
      else if(withDog&&!runtime.taskCompleted&&!dog.sleeping) {
        if(dog.status==='eating') {
          dog.eatTimer+=seconds;
          if(dog.eatTimer>=2){dog.energy=dog.maxEnergy;dog.status='happy';dog.happy=true;dog.following=true;dog.companion=true;dog.distractionReason=null;runtime.taskCompleted=true;dogRouteAge=Infinity;emit('fed',{name:dog.name});}
        } else {
          dog.energy=Math.max(0,dog.energy-(wing.dog.drain??2.4)*seconds);
          if(dog.energy<=0){dog.status='sleeping';dog.sleeping=true;dog.following=false;dogPath=[];emit('sleep',{name:dog.name});}
          else if(dog.following) {
            followDog(movement,state);
            if(dog.following&&bowl&&Math.hypot(dog.x-bowl.x,dog.y-bowl.y)<=bowl.radius&&Math.hypot(state.player.x-bowl.x,state.player.y-bowl.y)<=3.4){dog.following=false;dog.status='eating';dog.eatTimer=0;dogPath=[];emit('feeding',{name:dog.name});}
          }
          whineAge+=seconds;
          if(!dog.sleeping&&dog.status!=='eating'&&whineAge>=10){whineAge=0;dog.whineUntil=runtime.clock+1.8;emit('whine',{name:dog.name,energy:dog.energy});}
        }
      }
      if(!inWing)return;
      eater.moving=false;eaterRouteAge+=seconds;
      // Let the player meet Nico before he starts competing for the food.
      // Visiting Waffles or the wing hallway alone never starts his appetite.
      if(!eater.activated&&world.getRoom(state.player.x,state.player.y,level())?.id===eater.room)eater.activated=true;
      const remaining=eater.activated?world.snacks.filter(snack=>snack.level===level()&&!state.found.has(snack.id)&&!runtime.consumed.has(snack.id)):[];
      let target=remaining.find(snack=>snack.id===eater.target);
      if(!target){if(eater.target||eater.status!=='wandering'){eaterPath=[];eaterRouteAge=Infinity;}eater.target=null;eater.eatTimer=0;eater.status='wandering';eater.heldIcon=null;munchAge=0;}
      if(!target&&remaining.length){target=remaining.reduce((best,snack)=>Math.hypot(snack.x-eater.x,snack.y-eater.y)<Math.hypot(best.x-eater.x,best.y-eater.y)?snack:best);eater.target=target.id;}
      if(target) {
        const gap=Math.hypot(target.x-eater.x,target.y-eater.y),eatRadius=wing.eater.eatRadius??1.15;
        if(gap<=eatRadius){const firstBite=eater.status!=='eating';eater.status='eating';eater.heldIcon=target.icon;eater.eatTimer+=seconds;munchAge+=seconds;
          if(firstBite||munchAge>=.85){munchAge=0;emit('munch',{snackId:target.id,icon:target.icon});}
          if(eater.eatTimer>=(wing.eater.eatDuration??2.5)){runtime.consumed.add(target.id);emit('snackEaten',{snackId:target.id,name:target.name,icon:target.icon});eater.target=null;eater.eatTimer=0;eaterPath=[];}
        }else{eater.status='searching';eater.eatTimer=0;munchAge=0;if(eaterRouteAge>=1.5){eaterPath=route(eater,target,Math.max(.1,eatRadius-.01));eaterRouteAge=0;}followPath(eater,eaterPath,(wing.eater.speed??1.2)*movement,.003,.22);}
      } else if(wing.eater.route?.length){eater.status='wandering';const goal=wing.eater.route[eater.routeIndex%wing.eater.route.length];if(Math.hypot(goal.x-eater.x,goal.y-eater.y)<.15){eater.routeIndex++;eaterPath=[];}else{if(!eaterPath.length)eaterPath=route(eater,goal);followPath(eater,eaterPath,(wing.eater.speed??1.2)*movement,.05,.22);}}
    }
    reset();
    return {reset,update,interact,canInteract,play,canPlay,changeFloor,getState:()=>runtime,drainEvents:()=>events.splice(0)};
  }
  window.HSWing={create};
})();
