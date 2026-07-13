const RPC='https://mainnet.base.org';const C='0x14065412b3A431a660e6E576A14b104F1b3E463b';
async function call(sel){const r=await(await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:C,data:sel},'latest']})})).json();return r.result;}
function decodeStr(hex){if(!hex||hex==='0x')return '(none)';try{const h=hex.slice(2);const len=parseInt(h.slice(64,128),16);const s=h.slice(128,128+len*2);return Buffer.from(s,'hex').toString('utf8');}catch{return '(decode err)';}}
console.log('name():', decodeStr(await call('0x06fdde03')));
console.log('contractURI():', decodeStr(await call('0xe8a3d485')));
process.exit(0);
