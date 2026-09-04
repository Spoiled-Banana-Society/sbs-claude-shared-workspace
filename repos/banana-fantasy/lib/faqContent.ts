import type { FAQSection } from '@/types';
import { SPIN_ON_PURCHASE_UI_ENABLED } from '@/lib/spinTypes';
import { LEGACY_SLOW_CLOCK_COPY, type SlowClockCopy } from '@/lib/slowClock';

/**
 * FAQ content as a function of the slow-draft clock switch (lib/slowClock.ts),
 * so "8 hours per pick" flips to whatever is live without a copy hunt. Client
 * components: `buildFAQSections(useSlowClock().copy)`. `mockFAQSections` is the
 * legacy (switch-off) snapshot for anything that can't use the hook.
 */
export function buildFAQSections(clock: SlowClockCopy = LEGACY_SLOW_CLOCK_COPY): FAQSection[] {
  return [
  {
    id: 'best-ball',
    title: 'Best Ball',
    items: [
      {
        question: 'What is Best Ball fantasy football?',
        answer: 'Best Ball is a set it and forget it fantasy format. After you draft your team, the platform automatically starts your highest scoring players each week. No lineup management, no waivers, no trades to worry about - just draft and watch your team compete all season.',
      },
      {
        question: 'How does Best Ball scoring work?',
        answer: 'Each week, your best players at each position are automatically selected based on their actual performance. Your weekly score is the sum of your best performers according to your roster requirements (1 QB, 2 RB, 2 WR, 1 TE, 1 Flex, 1 DST, plus 7 bench).',
      },
      {
        question: 'Can I trade or drop players after drafting?',
        answer: 'No trades or waivers in Best Ball - that\'s the beauty of it! However, you can sell your entire team on our marketplace any time during the season if you want out.',
        audience: 'web2',
      },
      {
        question: 'Can I trade or drop players after drafting?',
        answer: 'No trades or waivers in Best Ball - that\'s the beauty of it! However, because your teams are tradeable digital assets, you can sell your entire team on our marketplace at any time during the season if you want out.',
        audience: 'web3',
      },
    ],
  },
  {
    id: 'team-positions',
    title: 'Team Positions',
    items: [
      {
        question: 'What are Team Positions?',
        answer: 'Instead of drafting players like Patrick Mahomes, you draft Team Positions — e.g. "KC QB" or "DAL WR1". Each week you automatically score the top performer at that slot for that team. Example: you draft DAL WR1 — if CeeDee Lamb drops 28 that week, you get 28, but if George Pickens goes for 37, you\'d get his points instead.\n\nThere\'s also WR2, RB2, and so on — WR2 just means the team\'s second-highest scorer at that position that week (same with RB2). So you can roster DAL WR1 and PHI WR2 and stack the best receivers and backs from across the league.',
      },
      {
        question: 'Why draft Team Positions instead of players?',
        answer: 'You\'re never out of it. In traditional fantasy, one injury can destroy your season. With Team Positions, if a starter gets hurt, you automatically get points from whoever replaces them. Your team stays competitive all season regardless of injuries.',
      },
      {
        question: 'How does this add strategy?',
        answer: 'Team Positions add a unique strategic layer. You\'re evaluating team depth, offensive systems, and coaching tendencies instead of just individual talent. A team with two great WRs might be more valuable than one with a single elite receiver.',
      },
    ],
  },
  {
    id: 'drafts',
    title: 'How Drafts Work',
    items: [
      {
        question: 'Is this like a traditional 12-man redraft league?',
        answer: 'No — it\'s a tournament, not a season-long league. You draft a 15-slot roster against 9 other players, and your team plays all season on cumulative points. Weeks 1-14 are the regular season in your 10-team pod; the top 2 finishers advance into the playoff pods (Weeks 15-16) and then the Week 17 finals, all competing for one big guaranteed prize pool. Enter as many drafts as you want — each draft is another team, and another shot at the prizes.',
      },
      {
        question: 'How does a draft work?',
        answer: 'Drafts are 10-person leagues with 15 rounds using a snake draft format (pick order reverses each round). You have 30 seconds per pick. Drafts start immediately when 10 players join - no scheduled times to wait for.',
      },
      {
        question: 'What happens when I enter a draft?',
        answer: 'You join a room that fills to 10 players. Once full, a 60-second countdown starts and your draft type is revealed slot machine style - Jackpot, HOF, JackHOF (the ultra-rare Jackpot + HOF combo), or Pro. Then you draft!',
      },
      {
        question: 'What\'s the difference between Fast and Slow drafts?',
        answer: 'Fast drafts have a 30-second pick clock — the whole draft runs about 30-40 minutes. Slow drafts give you ' + clock.long + ' per pick (the clock pauses overnight, ' + clock.pauseWindowLabel.replace('–', '-') + ').' + (clock.pauseNote ? ' ' + clock.pauseNote : '') + ' Regular slow drafts are closed to new entries — slow drafts now run only in special leagues like Jackpot, JackHOF and HOF.' + clock.shorteningNote,
      },
    ],
  },
  {
    id: 'scoring',
    title: 'Scoring',
    items: [
      {
        question: 'What is the starting lineup?',
        answer: '1 QB\n2 RB\n2 WR\n1 TE\n1 Flex (RB/WR/TE)\n1 DST\n\n+ 7 Bench',
      },
      {
        question: 'How are offensive points calculated?',
        answer: 'Full PPR. The highest scorer at each team-position counts every week.\n\nPASSING\nPassing TD  +4\nPassing yards  +1 per 25\n300+ passing yards  +3 bonus\nInterception thrown  −1\n\nRUSHING\nRushing TD  +6\nRushing yards  +1 per 10\n100+ rushing yards  +3 bonus\n\nRECEIVING\nReceiving TD  +6\nReceiving yards  +1 per 10\n100+ receiving yards  +3 bonus\nReception  +1\n\nMISC\nFumble lost  −1\nFumble-return TD  +6\n2-point conversion  +2',
      },
      {
        question: 'How does defense/special teams scoring work?',
        answer: 'DEFENSE / SPECIAL TEAMS\nSack  +1\nInterception  +2\nFumble recovery  +1\nForced fumble  +1\nSafety  +2\nDefensive / ST TD  +6\nBlocked kick  +2\n\nPOINTS ALLOWED\n0  +10\n1-6  +7\n7-13  +4\n14-20  +1\n21-27  0\n28-34  −1\n35+  −4',
      },
    ],
  },
  {
    id: 'jackpot',
    title: 'Jackpot Drafts',
    items: [
      {
        question: 'What is a Jackpot Draft?',
        answer: 'Jackpot Drafts are the rarest draft type — just 1% of all drafts. Finish 1st in a Jackpot draft and you skip straight to the Week 17 finals, bypassing both playoff rounds (Weeks 15 and 16). 2nd place still advances to the playoffs like any other league. Landing one is huge: 1st place gets a guaranteed spot in the finals from day one, while everyone else still has to fight through the bracket to get there.',
      },
      {
        question: 'How do I get into a Jackpot Draft?',
        answer: 'Two ways. 1) The reveal: every draft has a chance to become a Jackpot — when your draft room fills to 10/10 players, the slot machine reveals your draft type. 2) The Banana Wheel: land on Jackpot and you win a guaranteed seat in a special Jackpot draft, free.',
      },
      {
        question: 'How does the guaranteed distribution work?',
        answer: 'This is NOT random odds — it\'s a guaranteed rolling window. A Jackpot is always hiding somewhere in the next 100 drafts, and the moment it hits, a fresh 100-draft window starts — so a Jackpot is never more than 100 drafts away from the last one. HOF works the same way: 5 HOF slots per window, resetting after the 5th hits. The positions are provably random, but the guarantees are locked. You can watch both counters live at the top-right of the header — the odds climb as a window goes unhit.',
      },
      {
        question: 'I hit Jackpot on the Banana Wheel — what happens now?',
        answer: 'You\'re automatically seated in a special Jackpot draft, free. It sits ready and starts on its own the moment 10 wheel winners have joined. It\'s a slow draft — ' + clock.long + ' per pick, and the clock pauses overnight (' + clock.pauseWindowLabel + '). With Draft Alerts on, we\'ll notify you when it starts and every time you\'re on the clock.',
      },
      {
        question: 'Can I leave a wheel-won Jackpot, HOF, or JackHOF draft?',
        answer: 'No — your seat is locked from the moment you win it. But you CAN sell the pass on the SBS Marketplace while the draft is still filling — the buyer takes over your seat, name and all. Once the draft fills it becomes your team, and you can still sell that team on the Marketplace afterward, like any other team.',
      },
      {
        question: 'Why is this the only sellable draft pass?',
        answer: 'A wheel-won Jackpot, HOF, or JackHOF pass is a guaranteed seat in a special draft — that\'s real value you might not be able to use, so we let you trade it before the draft starts. Every other free pass can only be used to enter drafts. The moment the special draft fills, the trade window closes.',
      },
      {
        question: 'Do special wheel-won drafts earn promos?',
        answer: 'No. Special Jackpot/HOF/JackHOF drafts are free drafts and never earn promos — hitting a Slot 10 in one doesn\'t award a free spin, and the draft doesn\'t count toward the 4-drafts-in-a-day promo.',
      },
      {
        question: 'What exactly happens if I win a Jackpot league?',
        answer: 'Win your 10-person Jackpot league during the regular season (Weeks 1-14) and you advance directly to the Week 17 finals, skipping the Week 15 and Week 16 playoff rounds entirely. A guaranteed shot at the biggest prizes.',
      },
    ],
  },
  {
    id: 'hof',
    title: 'Hall of Fame Drafts',
    items: [
      {
        question: 'What is a HOF (Hall of Fame) Draft?',
        answer: 'HOF Drafts are premium draft rooms (5% of all drafts) that compete for a separate bonus prize pool on top of the regular tournament prizes. Your team earns a special HOF badge and is eligible for exclusive end-of-season bonuses.',
      },
      {
        question: 'How is HOF different from Jackpot?',
        answer: 'Jackpot winners skip to finals (advancement perk). HOF leagues compete for additional bonus prizes on top of regular rewards (prize perk). You can win both regular tournament prizes AND HOF bonuses in the same season.',
      },
      {
        question: 'How do HOF playoffs work?',
        answer: 'HOF leagues play the regular tournament like everyone else — the top 2 in your HOF pod (Weeks 1-14) advance to the regular playoffs. On top of that, only the 1st-place team also advances into a separate HOF playoff track (Weeks 15-17, also cumulative) that pays a bonus prize pool on top of the regular tournament prizes.',
      },
      {
        question: 'What are the odds of getting a HOF draft?',
        answer: 'HOF drafts average 5% of all drafts, and it\'s guaranteed, not luck: every rolling 100-draft window contains 5 HOF slots, and the window resets as soon as the 5th one hits. The positions are provably random, but you\'re never far from the next HOF.',
      },
      {
        question: 'I hit HOF on the Banana Wheel — what happens now?',
        answer: 'Same flow as a wheel Jackpot: you\'re seated in a special HOF draft instantly, it starts automatically when 10 wheel winners are in, and it runs as a slow draft (' + clock.long + ' per pick, paused overnight). Your seat is locked, but the pass is sellable on the Marketplace before the draft, and your team can be sold after it wraps — the only time you can\'t sell is while the draft is live. Special drafts never earn promos.',
      },
    ],
  },
  {
    id: 'jackhof',
    title: 'JackHOF Drafts',
    items: [
      {
        question: 'What is a JackHOF Draft?',
        answer: 'The rarest draft in SBS — the Jackpot and a HOF landing on the SAME draft. A JackHOF league carries BOTH perks: win it and you skip straight to the Week 17 finals AND you\'re in the HOF playoff track competing for bonus prizes on top. Two perks, one draft.',
      },
      {
        question: 'How rare is a JackHOF?',
        answer: 'The Jackpot and HOF slots are drawn independently in their rolling windows, so they only collide on the same draft about once in 800 drafts — it can go a whole season without happening. There\'s also a JackHOF wedge on the Banana Wheel at 0.1%, which wins you a guaranteed seat in a special JackHOF draft.',
      },
      {
        question: 'What happens if I win a JackHOF league?',
        answer: 'Everything. You advance directly to the Week 17 finals (the Jackpot perk, skipping both playoff rounds) and your team also enters the separate HOF playoff track for bonus prizes (the HOF perk). Your draft token gets the exclusive red-and-gold JackHOF border.',
      },
      {
        question: 'I hit JackHOF on the Banana Wheel — what happens now?',
        answer: 'Same flow as a wheel Jackpot or HOF, but better: you\'re seated free in a special JackHOF draft that starts automatically once 10 wheel winners join. Slow draft, ' + clock.long + ' per pick, paused overnight. Your seat is locked, but the pass can be sold on the Marketplace before the draft, and the team can be sold after it wraps — the only time you can\'t sell is while the draft is live.',
      },
    ],
  },
  {
    id: 'founder-draft',
    title: 'Founder Drafts',
    items: [
      {
        question: 'What is a Founder Draft?',
        answer: 'Every Wednesday at 6 PM PT the founders (the Vag Bros) jump into the draft queue like everyone else — whichever draft they land in becomes that week\'s Founder Draft, streamed live on X.\n\nWhy you want in: everyone in the Founder Draft unlocks the exclusive Founders badge and gets a shot at skipping the playoffs — and paid entries also earn a Free Banana Spin.',
      },
      {
        question: 'What do I win?',
        answer: 'Being in the Founder Draft gets you:\n\n• Founders badge — everyone in the draft (paid OR free) unlocks the exclusive Founders badge.\n\n• A shot at skipping the playoffs — outscore the founder in your league and you\'re entered into a draw against everyone who beat them across all Founder leagues; one winner is picked to skip straight to the finals. Open to everyone in the draft.\n\n• Free Banana Spin — paid entries get a free spin on the Banana Wheel.\n\nThe only thing a free entry misses is the Free Banana Spin — the badge and the skip-the-playoffs shot are for everyone.\n\nNote: in a Founder Draft the Pick 10 spin doesn\'t apply — landing the last pick won\'t earn an extra spin, since paid entries already get the Founder Free Banana Spin.',
      },
      {
        question: 'How do I get in?',
        answer: 'There\'s no scheduled room — at exactly 6 PM PT, join a draft. Drafts fill fast in the rush, and only the one the founders actually land in counts.\n\nYou won\'t know right away: while your draft is still filling, nothing shows (it\'s hidden so it can\'t be gamed). Once your draft FILLS (all 10 seats), the founders and the FOUNDER sticker appear if you landed in the right one.',
      },
      {
        question: 'I joined but don\'t see the founders — did I miss it?',
        answer: 'Check once your draft is FULL (10/10) — the founders and the FOUNDER sticker only show after the draft fills, not the moment you join. If they\'re there, you\'re in. If they\'re NOT there once it\'s full, you joined a different draft and missed it this week — try again next week.',
      },
    ],
  },
  {
    id: 'tournament',
    title: 'Tournament & Prizes',
    items: [
      {
        question: 'How does the tournament structure work?',
        answer: 'Weeks 1-14 — Regular season in your 10-team pod. Scoring is CUMULATIVE: your team stacks points every week, and the top 2 in your pod advance to the playoffs.\nWeek 15 — a fresh pod of 10, top 2 advance.\nWeek 16 — another fresh pod of 10, top 2 advance.\nWeek 17 — Finals pod plays for the grand prize.\n\nJackpot winners skip straight to the finals. HOF leagues run their own parallel playoff track (Weeks 15-17, 1st place advances from the 1-14 pod).',
      },
      {
        question: 'What can I win?',
        answer: 'The guaranteed prize pool — shown as an example on the contest screen, and it only grows as more teams enter — pays out across the finals (1st place takes the biggest share), per-league winners, weekly top-scorer prizes, and a separate HOF bonus pool.',
      },
      {
        question: 'Are there weekly prizes?',
        answer: 'Yes! Each week, the top-5 highest scorers across all leagues win additional prizes. You can win weekly prizes even if your team doesn\'t make the playoffs.',
      },
    ],
  },
  {
    id: 'banana-wheel',
    title: 'Banana Wheel',
    items: [
      {
        question: 'How do I earn Banana Wheel spins?',
        answer: `Earn spins by completing promotions like "4 Drafts in 24 Hours", landing the last pick (Pick 10) in a paid draft, or participating in special events.${SPIN_ON_PURCHASE_UI_ENABLED ? ' Plus, every draft pass you buy comes with a free bonus spin — automatically.' : ''} One exception: in a Founder Draft the Pick 10 spin doesn't apply — paid entries already get the Founder Free Banana Spin, so it doesn't stack. Check the promotions section for current ways to earn spins.`,
      },
      // ⚠️ "Every spin wins" is true ONLY of promo spins. A purchase spin pays
      // the wedge MINUS the seat already bought, so landing on 1 Draft credits
      // nothing. Swapped at build time on NEXT_PUBLIC_SPIN_ON_PURCHASE so the
      // page can never promise a win the wheel won't pay.
      SPIN_ON_PURCHASE_UI_ENABLED
        ? {
            question: 'What prizes can I win on the Banana Wheel?',
            answer: 'Prizes include 1, 2, 5, 10, or up to 20 draft passes, guaranteed Jackpot draft entries, guaranteed HOF draft entries — and the 0.1% JackHOF wedge, a guaranteed seat in a draft with BOTH perks. Spins you earn from promotions always win something. Bonus spins that come free with a purchase pay whatever the wheel lands on beyond the draft you already bought, so landing on 1 Draft means no extra drafts that spin — you keep the draft you paid for either way.',
          }
        : {
            question: 'What prizes can I win on the Banana Wheel?',
            answer: 'Every spin wins! Prizes include: 1, 2, 5, 10, or up to 20 free draft passes, guaranteed Jackpot draft entries, guaranteed HOF draft entries — and the 0.1% JackHOF wedge, a guaranteed seat in a draft with BOTH perks. The wheel is weighted but every outcome is a winner.',
          },
      ...(SPIN_ON_PURCHASE_UI_ENABLED
        ? [
            {
              question: 'Do I get a spin when I buy a draft?',
              answer: 'Yes. Every draft entry you buy comes with one free bonus spin on the Banana Wheel. The spin is a bonus and nothing more — your draft entry is confirmed the moment you buy it, whatever the wheel does. You can spin right away or save it for later.',
            },
            {
              question: 'The wheel landed on "1 Draft" — did I win anything?',
              answer: 'On a bonus spin from a purchase, no — that 1 draft is the entry you already bought, so there are no extra drafts on that spin. You keep your draft regardless. On a promo spin, landing on 1 Draft does win you a free draft pass.',
            },
            {
              question: 'What is the difference between Promo Spins and Bonus Spins?',
              answer: 'Promo Spins are earned from promotions — sharing, referrals, events, new-player offers — and always win something, starting at 1 free draft pass. Bonus Spins come free with a draft you bought and pay out anything the wheel lands on above that draft — land on 5 Drafts and 1 of them is the draft you bought, so 4 bonus passes are added. Your spin balance shows both separately, and Promo Spins are always used first.',
            },
          ]
        : []),
      {
        question: 'What is a "special draft"?',
        answer: 'A draft made up entirely of Banana Wheel winners. Hit Jackpot, HOF, or JackHOF on a spin and you get a free seat — the draft starts automatically once 10 winners have joined. Special drafts are always slow drafts (' + clock.long + ' per pick), every seat is locked, and the pass is the only one on SBS that can be sold on the Marketplace (before the draft — and your drafted team can be sold after it wraps, just never mid-draft). They\'re free drafts, so they never earn promos.',
      },
      {
        question: 'Where can I spin the wheel?',
        answer: 'Head to the Banana Wheel page to use your spins.',
        link: {
          label: 'Go to Banana Wheel',
          href: '/banana-wheel',
        },
      },
    ],
  },
  {
    id: 'base-usdc',
    title: 'New: Base using USDC',
    // Crypto-only — hidden from confirmed web2 (embedded-wallet) users, who pay
    // by card and never touch Base/USDC/gas/networks directly.
    audience: 'web3',
    items: [
      {
        question: 'What changed from previous seasons?',
        answer: 'We moved from Ethereum Mainnet to Base, and entries are now paid in USDC instead of ETH. Same game, much smoother experience: transactions confirm in seconds, and every transaction on SBS is gas-free - we cover it, so you never need ETH to play.',
        link: {
          label: 'Base setup guide (2 min)',
          href: '/get-usdc',
        },
      },
      {
        question: 'Why did SBS move to Base using USDC?',
        answer: '• $25 is $25 - entries are priced in dollars, not ETH. No price swings.\n• Prize pools hold their value - $100,000 in USDC stays $100,000, all season.\n• Transactions confirm in seconds on Base.\n• Everything on SBS is gas-free - we cover it.\n• Even swapping or bridging into Base costs cents.\nThe game, made better for you.',
      },
      {
        question: 'What is Base?',
        answer: 'Base is an Ethereum Layer 2 network built by Coinbase. It uses the same wallets and the same addresses as Ethereum - your MetaMask or Coinbase Wallet works as-is, you just switch networks. Transactions are near-instant and cost a fraction of a cent.',
      },
      {
        question: 'Do I need ETH for gas?',
        answer: 'Not to play. Every transaction on SBS - minting passes, buying and selling on the marketplace - is gas-free, we cover it. The only fees you might ever pay are outside SBS: if you swap or bridge on another site (like Relay or Coinbase), their small network fee applies and is shown in their quote. You can also skip crypto entirely and add funds or pay with a debit card - card payments carry a processing fee, but we cover it: your first card payment comes with a free Paid Draft Pass, and after that every $25 you accumulate in card fees earns you another one automatically (Paid Draft Passes are the same passes you buy - they count for promos).',
      },
      {
        question: 'I have ETH on Ethereum Mainnet - how do I play?',
        answer: 'Easiest path: swap it straight to USDC on Base with Relay - one transaction, no separate bridging, lands in seconds. Or go through Coinbase: deposit your ETH, convert to USDC, withdraw on the Base network. Our guide walks through both step by step.',
        link: {
          label: 'How to get USDC on Base',
          href: '/get-usdc',
        },
      },
      {
        question: 'How do I switch my wallet to Base?',
        answer: 'Depends on the wallet. Log in with email or social? Nothing to do - your SBS wallet is already on Base. Coinbase Wallet has Base built in. MetaMask takes about 30 seconds to switch - the Base setup guide below has separate steps for desktop and mobile, since the apps differ.',
        link: {
          label: 'Wallet setup steps',
          href: '/get-usdc',
        },
      },
      {
        question: 'What if I send funds on the wrong network?',
        answer: 'Always pick Base as the network when sending USDC - sending on the wrong network can lose your funds. If you\'re unsure, send a small test amount first and confirm it arrives. If something looks off, stop and message us in Discord before sending more.',
      },
    ],
  },
  {
    id: 'purchasing',
    title: 'How To Purchase',
    items: [
      {
        question: 'How much does it cost to enter?',
        answer: `Each draft costs $25. Add money to your balance once, then every entry is one tap - hit Enter, pick your speed, and $25 comes out of your balance. Any draft passes you already have are always used first, free. You can still buy multiple draft passes at once if you like to stock up${SPIN_ON_PURCHASE_UI_ENABLED ? ' - and every draft pass you buy comes with a free bonus spin on the Banana Wheel' : ''}.`,
        link: {
          label: 'Buy Draft Passes',
          href: '/buy-drafts',
        },
      },
      {
        question: 'How does my balance work?',
        answer: 'The balance in the top bar is your money, in your own account - adding funds never charges you anything beyond the amount you add. Tap the + any time to add more ($25 to $500 presets, or a custom amount). When you enter a draft with no passes left, the $25 entry comes straight out of your balance - no checkout, no extra steps.',
      },
      {
        question: 'What payment methods are accepted?',
        answer: 'Apple Pay, Venmo, PayPal, or debit card — quick and easy at checkout.',
        audience: 'web2',
      },
      {
        question: 'What payment methods are accepted?',
        answer: 'Apple Pay, Venmo, PayPal, debit card, or pay directly with USDC on Base.',
        audience: 'web3',
      },
      {
        question: 'How do I get USDC on Base to pay with crypto?',
        answer: 'If you already hold ETH or other crypto, you have a few easy options: swap it to USDC on Base in one step with Relay, move it through Coinbase and withdraw USDC on the Base network, or simply buy USDC directly on Coinbase or in MetaMask. Our step-by-step guide walks through each method - including your exact wallet address to send to.',
        audience: 'web3',
        link: {
          label: 'How to get USDC on Base',
          href: '/get-usdc',
        },
      },
    ],
  },
  {
    id: 'buy-sell',
    title: 'Buy/Sell Teams',
    items: [
      {
        question: 'Can I sell my drafted team?',
        answer: 'Yes! You can sell your team on our marketplace any time during the season. Bad start? Sell and recoup some value. See a contender for sale? Buy your way in.',
        audience: 'web2',
        link: {
          label: 'View Marketplace',
          href: '/marketplace',
        },
      },
      {
        question: 'Can I sell my drafted team?',
        answer: 'Yes! Your teams are tradeable digital assets, so you can sell them on our marketplace at any time during the season. Bad start? Sell and recoup some value. See a contender for sale? Buy your way in.',
        audience: 'web3',
        link: {
          label: 'View Marketplace',
          href: '/marketplace',
        },
      },
      {
        question: 'How do I buy someone else\'s team?',
        answer: 'Check out our leaderboards to see which teams are performing well and have winnings. From there, you can click through to our marketplace to view the team, see who owns it, and make an offer. When you purchase a team, the team and any future prize winnings transfer to your account.',
        link: {
          label: 'View Leaderboards',
          href: '/teams',
        },
      },
      {
        question: 'Why is this unique?',
        answer: 'No other fantasy platform lets you trade teams mid-season. On Underdog or Sleeper, you\'re stuck with your team. Here, your team is your asset - buy low on struggling teams, sell high on hot ones, or hold and compete.',
      },
    ],
  },
  {
    id: 'rules',
    title: 'Rules & Fair Play',
    items: [
      {
        question: 'Can I have multiple accounts?',
        answer: 'No. Users must maintain only one account. Multi-accounting or collusion results in immediate account termination and forfeiture of all prizes and entries.',
      },
      {
        question: 'Can I cancel my draft entry?',
        answer: 'You can exit a filling draft (before 10/10 players join) and your draft pass will be returned. Once a draft is full and starts, you\'re committed.',
      },
      {
        question: 'Is the randomness fair?',
        answer: 'Yes - and you can verify it yourself. We use Chainlink VRF (Verifiable Random Function) for all randomness. This means draft type assignments and draft order are generated using cryptographic proof that can\'t be manipulated by anyone, including us. Every draft shows a "Verified" badge you can click to see the proof.',
      },
      {
        question: 'What does the "Verified" badge mean?',
        answer: 'The "Verified" badge appears next to your draft type (Jackpot, HOF, or Pro) and confirms the result was generated using Chainlink VRF - provably fair randomness. Click the badge to view the transaction proof on our verification page and verify it yourself.',
      },
      {
        question: 'How do I verify my draft was fair?',
        answer: 'Hover over any "Verified" badge to see the proof details including the block number and transaction hash. Click the badge to open our verification page and view the full transaction. The VRF proof shows the exact randomness used to determine your draft type and pick position.',
      },
    ],
  },
  {
    id: 'about',
    title: 'About SBS',
    items: [
      {
        question: 'Who is behind Banana Best Ball?',
        answer: 'Banana Best Ball is built by Spoiled Banana Society (SBS), founded in 2021 — and we\'ve paid out millions in prizes since. SBS was founded by two brothers, Boris and Richard Vagner. Justin Herzig, a well-known name in the best ball community, advises the team.',
      },
      {
        question: 'What makes SBS different?',
        answer: 'Three things set us apart:\n• Team Positions — you draft a team\'s slot (like DAL WR1), so one player\'s injury never sinks your season.\n• Buy & Sell — your team is yours to trade on the marketplace anytime: sell a slow start, or buy your way into a contender.\n• Gamification — every draft can hit a Jackpot, Hall of Fame, or the ultra-rare JackHOF, unlocking bonus spins and bigger prizes.\nFantasy sports, evolved.',
        audience: 'web2',
      },
      {
        question: 'What makes SBS different?',
        answer: 'Four things set us apart:\n• Team Positions — you draft a team\'s slot (like DAL WR1), so one player\'s injury never sinks your season.\n• Buy & Sell — your team is yours to trade on the marketplace anytime: sell a slow start, or buy your way into a contender.\n• Gamification — every draft can hit a Jackpot, Hall of Fame, or the ultra-rare JackHOF, unlocking bonus spins and bigger prizes.\n• First & only — we\'re the first and only on-chain fantasy drafting platform: provably fair, with teams you truly own.\nFantasy sports, evolved.',
        audience: 'web3',
      },
    ],
  },
];
}

export const mockFAQSections: FAQSection[] = buildFAQSections(LEGACY_SLOW_CLOCK_COPY);
