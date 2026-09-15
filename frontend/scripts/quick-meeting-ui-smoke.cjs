// Run against the local Vite server. API responses are isolated test fixtures.
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true,channel:"chrome"});
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 const writes=[]; const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('ai_compliance_token','local-ui-fixture'));
 const meeting={id:'meeting-quick-fixture',title:'快速会议验收',type:'快速会议',meetingMode:'normal',phase:'会后终审',date:'2026-09-15T13:00',agenda:'',agendaDrafts:[],issueSources:[],events:[],materials:[],creator:'验收管理员',generatedRecords:{generated:false},reviewDone:false};
 await page.route('**/api/**',async route=>{
  const req=route.request(); const path=new URL(req.url()).pathname;
  if(req.method()!=='GET') writes.push({path,method:req.method()});
  let data={success:true,items:[],events:[],transcripts:[],total:0};
  if(path==='/api/auth/me') data={user:{username:'fixture',name:'验收管理员',role:'admin'}};
  else if(path==='/api/meetings') data={meetings:[meeting],total:1};
  else if(path==='/api/meetings/'+meeting.id) data={meeting};
  else if(path.endsWith('/records/snapshot')) data={records:{generated:false,summary:[],minutes:[],decisions:[],todos:[]}};
  else if(path.endsWith('/generation-status')) data={status:'idle'};
  else if(path.includes('/versions')) data={versions:[]};
  else if(path.includes('/review/summary')) data={summary:{total:0}};
  else if(path.includes('/agendas')) data={agendas:[]};
  else if(path.includes('/users')) data={users:[]};
  else if(path.includes('/departments')) data={departments:[]};
  else if(path.endsWith('/diarization')) data={enabled:false,status:'idle',recordings:[]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:3000/?page=ai_meeting');
 await page.waitForTimeout(6500);
 await page.getByRole('button', {name:/继.*续/}).first().click();
 await page.waitForTimeout(1800);
 await page.screenshot({path:'/tmp/ai616-before-history.png'});

 await page.getByRole('button', {name:/查看会议记录/}).click();
 await page.waitForTimeout(800);
 await page.screenshot({path:'/tmp/ai616-quick-history.png'});
 await page.setViewportSize({width:1920,height:1080});
 await page.waitForTimeout(300);
 await page.screenshot({path:'/tmp/ai616-quick-history-1920.png'});
 await page.getByRole('tab',{name:'录音与字幕',exact:true}).click();
 await page.getByRole('button',{name:'返回纪要审核',exact:true}).click();
 await page.waitForTimeout(800);
 if (writes.length || errors.length) throw new Error(JSON.stringify({writes,errors}));
 console.log('PASS: history navigation has no write requests or runtime errors (local API fixtures)');
 await browser.close();
})();
