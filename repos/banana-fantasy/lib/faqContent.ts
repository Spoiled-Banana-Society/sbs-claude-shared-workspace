import type { FAQSection } from '@/types';

export const mockFAQSections: FAQSection[] = [
  {
    id: 'best-ball',
    title: 'Best Ball',
    items: [
      {
        question: 'What is Best Ball fantasy football?',
        answer: 'Best Ball is a set-it-and-forget-it fantasy format. After you draft your team, the platform automatically starts your highest-scoring players each week. No lineup management, no waivers, no trades to worry about - just draft and watch your team compete all season.',
      },
      {
        question: 'How does Best Ball scoring work?',
        answer: 'Each week, your best players at each position are automatically selected based on their actual performance. Your weekly score is the sum of your best performers according to your roster requirements (1 QB, 2 RB, 2 WR, 1 TE, 1 Flex, 1 DST, plus 7 bench).',
      },
      {
        question: 'Can I trade or drop players after drafting?',
        answer: 'No trades or waivers in Best Ball - that\'s the beauty of it! However, because your teams are tradeable digital assets, you can sell your entire team on our marketplace at any time during the season if you want out.',
      },
    ],
  },
  {
    id: 'team-positions',
    title: 'Team Positions',
    items: [
      {
        question: 'What are Team Positions?',
        answer: 'Instead of drafting individual players like Patrick Mahomes, you draft Team Positions like "KC QB". Each week, you automatically get the points from the highest-scoring player at that position for that team. Draft KC QB and you get whoever scores most - Mahomes, the backup, whoever plays.',
      },
      {
        question: 'Why draft Team Positions instead of players?',
        answer: 'You\'re never out of it. In traditional fantasy, one injury can destroy your season. With Team Positions, if a starter gets hurt, you automatically get points from whoever replaces them. Your team stays competitive all season regardless of injuries.',
      },
      {
        question: 'How does this add strategy?',
        answer: 'Team Positions add a unique strategic layer. You\'re evaluating team depth, offensive systems, and coaching tendencies instead of just individual talent. A team with a great backup QB might be more valuable than one without.',
      },
    ],
  },
  {
    id: 'drafts',
    title: 'How Drafts Work',
    items: [
      {
        question: 'Is this like a traditional 12-man redraft league?',
        answer: 'No - this is a tournament contest, not a season-long league with friends. You draft a team against 9 other players, and top finishers advance through playoffs to compete for a massive shared prize pool. You can draft as many teams as you want.',
      },
      {
        question: 'How does a draft work?',
        answer: 'Drafts are 10-person leagues with 15 rounds using a snake draft format (pick order reverses each round). You have 30 seconds per pick. Drafts start immediately when 10 players join - no scheduled times to wait for.',
      },
      {
        question: 'What happens when I enter a draft?',
        answer: 'You join a room that fills to 10 players. Once full, a 60-second countdown starts and your draft type is revealed slot machine style - Jackpot (1%), HOF (5%), or Pro (94%). Then you draft!',
      },
      {
        question: 'What\'s the difference between Fast and Slow drafts?',
        answer: 'Fast drafts have a 30-second pick clock - the whole draft takes about 15-20 minutes. Slow drafts give you 8 hours per pick, perfect if you want to draft over a few days.',
      },
    ],
  },
  {
    id: 'scoring',
    title: 'Scoring',
    items: [
      {
        question: 'How are offensive points calculated?',
        answer: 'Passing TDs: 4 pts. Rushing/Receiving TDs: 6 pts. Passing yards: 0.04 pts/yard (1 pt per 25 yards). Rushing/Receiving yards: 0.1 pts/yard (1 pt per 10 yards). Receptions: 0.5 pts (half-PPR). Interceptions and fumbles lost: -1 pt each.',
      },
      {
        question: 'How does defense/special teams scoring work?',
        answer: 'Points allowed: 0 pts = +10, 1-6 pts = +7, 7-13 pts = +4, 14-20 pts = +1, 21-27 pts = 0, 28-34 pts = -1, 35+ pts = -4. Turnovers (INT, fumble recovery): +2 each. Sacks: +1 each. Defensive/ST touchdowns: +6.',
      },
    ],
  },
  {
    id: 'jackpot',
    title: 'Jackpot Drafts',
    items: [
      {
        question: 'What is a Jackpot Draft?',
        answer: 'Jackpot Drafts are the rarest and most valuable draft type (1% of all drafts). If you win your league in a Jackpot draft, you skip straight to the finals, bypassing two weeks of playoffs. It\'s a massive shortcut to the grand prize.',
      },
      {
        question: 'How do I get into a Jackpot Draft?',
        answer: 'Every draft has a chance to become a Jackpot. When your draft room fills to 10/10 players, the slot machine reveals your draft type. You can also win guaranteed Jackpot entries on the Banana Wheel.',
      },
      {
        question: 'How does the guaranteed distribution work?',
        answer: 'This is NOT random odds - it\'s a guaranteed distribution system. Every 100 drafts contains exactly 1 Jackpot, 5 Hall of Fame, and 94 Pro drafts. The order is randomized, but the distribution is guaranteed. You\'re not gambling on luck - fair distribution is ensured for all players.',
      },
      {
        question: 'What exactly happens if I win a Jackpot league?',
        answer: 'Win your 10-person Jackpot league during the regular season (Weeks 1-14) and you advance directly to the Week 17 finals, skipping the Week 15 and Week 16 playoff rounds entirely. You get a direct shot at the grand prize.',
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
        question: 'What are the odds of getting a HOF draft?',
        answer: 'HOF drafts make up 5% of all drafts. With the guaranteed distribution system, every 100 drafts contains exactly 5 HOF drafts. The order is randomized, but you\'re guaranteed fair distribution.',
      },
    ],
  },
  {
    id: 'tournament',
    title: 'Tournament & Prizes',
    items: [
      {
        question: 'How does the tournament structure work?',
        answer: 'Weeks 1-14: Regular season in your 10-person league. Top 2 teams advance plus wild cards based on total points. Week 15: Playoff leagues formed. Week 16: Semifinal round. Week 17: Finals among all advancing teams.',
      },
      {
        question: 'What can I win?',
        answer: 'The prize pool includes season-long grand prizes (1st place wins the largest share), weekly prizes for top-5 scorers each week, and separate HOF bonus pools. Prizes are paid out in cash to your account.',
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
        answer: 'Earn spins by completing promotions like "Draft 3 times in a day", "Buy 10 draft passes" (1 spin per 10 passes), or participating in special events. Check the promotions section for current ways to earn spins.',
      },
      {
        question: 'What prizes can I win on the Banana Wheel?',
        answer: 'Every spin wins! Prizes include: 1, 5, 10, or up to 20 free draft passes, guaranteed Jackpot draft entries, and guaranteed HOF draft entries. The wheel is weighted but every outcome is a winner.',
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
    id: 'purchasing',
    title: 'How To Purchase',
    items: [
      {
        question: 'How much does it cost to enter?',
        answer: 'Each draft costs $25. You can buy multiple draft passes at once - the more you buy, the more Banana Wheel spins you earn (1 spin per 10 drafts purchased).',
        link: {
          label: 'Buy Draft Passes',
          href: '/buy-drafts',
        },
      },
      {
        question: 'What payment methods are accepted?',
        answer: 'Debit card or Apple Pay (powered by Coinbase), or pay directly with USDC on Base.',
      },
      {
        question: 'How do I get USDC on Base to pay with crypto?',
        answer: 'If you already hold ETH or other crypto, you have a few easy options: swap it to USDC on Base in one step with Relay, move it through Coinbase and withdraw USDC on the Base network, or simply buy USDC directly on Coinbase or in MetaMask. Our step-by-step guide walks through each method - including your exact wallet address to send to.',
        link: {
          label: 'How to get USDC on Base',
          href: '/get-usdc',
        },
      },
      {
        question: 'How do withdrawals work?',
        answer: 'Cash out to your bank account via Coinbase Offramp (ACH, 1-3 days) or withdraw USDC directly to your wallet on Base.',
      },
    ],
  },
  {
    id: 'buy-sell',
    title: 'Buy/Sell Teams',
    items: [
      {
        question: 'Can I sell my drafted team?',
        answer: 'Yes! Your teams are tradeable digital assets, so you can sell them on our marketplace at any time during the season. Bad start? Sell and recoup some value. See a contender for sale? Buy your way in.',
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
          href: '/my-teams',
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
        question: 'Who is behind Banana Fantasy?',
        answer: 'Banana Fantasy is created by Spoiled Banana Society (SBS), founded in 2021. We\'re passionate about combining fantasy sports with cutting-edge technology to create a more fair, liquid, and exciting experience.',
      },
      {
        question: 'What makes SBS different?',
        answer: 'We solve real problems in fantasy sports: Team Positions mean injuries don\'t kill your season. Tradeable teams mean you can buy/sell anytime. Guaranteed distribution means fair odds. It\'s fantasy sports evolved.',
      },
      {
        question: 'Where can I learn more or get help?',
        answer: 'Join our Discord community for support, strategy discussion, and announcements. Follow us on Twitter/X for updates. Links are in the footer.',
      },
    ],
  },
];
