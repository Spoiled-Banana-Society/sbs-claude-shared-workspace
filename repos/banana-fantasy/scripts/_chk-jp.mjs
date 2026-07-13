const API='https://sbs-drafts-api-staging-652484219017.us-central1.run.app';
const W='0x438bbe98eed1dd2df244b007dab0583cc9be72e0';
const d=await(await fetch(`${API}/owner/${W}/draftToken/all`)).json();
const lvl=t=>String(t.Level||t._level||t.level||'').toLowerCase();
const act=d.active||[];
const byLvl={};
for(const t of act){const l=lvl(t)||'(none)';byLvl[l]=(byLvl[l]||0)+1;}
console.log(`admin ACTIVE (drafted teams) = ${act.length}`);
console.log('by level:', JSON.stringify(byLvl));
console.log('jackpot teams:', act.filter(t=>lvl(t).includes('jackpot')).map(t=>({realTokenId:t.realTokenId,cardId:t._cardId||t.cardId,league:t._leagueId||t.leagueId})));
console.log('hof teams count:', act.filter(t=>lvl(t).includes('hall')||lvl(t)==='hof').length);
process.exit(0);
