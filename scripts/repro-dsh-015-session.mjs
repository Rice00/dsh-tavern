import { pathToFileURL } from 'node:url'
// Pass the installed DSH node_modules/@deepseek-ai directory; no user data is read.
const root = process.argv[2]?.replace(/\/?$/, '/')
if (!root) throw new Error('Usage: node scripts/repro-dsh-015-session.mjs <dsh/node_modules/@deepseek-ai>')
const { Session } = await import(pathToFileURL(root+'dsh-session/lib/index.js'))
const { sessionFormatV2ToV3: migration } = await import(pathToFileURL(root+'dsh-session-format-v2-to-v3/lib/index.js'))
const msg = (text) => ({ id: 'a-'+text, role:'assistant',content:[{type:'text',text}],source:{kind:'model',provider:'fixture',model:'fixture'}})
for (const cite of [true,false]) {
 const s=Session.create('replacement-probe')
 const old=s.append('assistant/message',{turn:1,step:1,message:msg('old'),stream:[]},{surfaceOp:'append'})
 try { s.append('assistant/message',{turn:1,step:1,message:msg('new'),stream:[]},{surfaceOp:{op:'replace',startSeq:old.seq,endSeq:old.seq},...(cite?{sourceEventSeqs:[old.seq]}:{})}); console.log('replacement',cite,'accepted') }
 catch(e){ console.log('replacement',cite,e.message) }
}
const sourceHeader={version:2,id:'migration-probe',createdAt:1,isSeeded:false,delegationDepth:0}
const stage=migration.createStage({sourceHeader,targetHeader:migration.migrateHeader(sourceHeader),sourceInheritedEventCount:0,sourceKind:'decoded'})

try {
 console.log(stage.transformEvent({type:'user/message',seq:0,time:1,data:{id:'prefix',role:'user',content:[{type:'text',text:'card context'}],source:{kind:'plugin',plugin:'dsh-tavern'}},surfaceOp:'append'}))
 stage.finish()
} catch(e){ console.log('migration before first step:',e.message) }
