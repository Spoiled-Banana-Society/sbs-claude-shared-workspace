// Draft room shared constants

export type DraftType = 'jackpot' | 'hof' | 'pro';
export type RoomPhase = 'filling' | 'pre-spin' | 'spinning' | 'result' | 'countdown' | 'drafting' | 'completed' | 'loading';

// ==================== POSITION COLORS ====================
export const POSITION_COLORS: Record<string, string> = {
  QB: '#FF474C',   // red
  RB: '#3c9120',   // green
  WR: '#cb6ce6',   // purple
  TE: '#326cf8',   // blue
  DST: '#DF893E',  // orange
};

// ==================== HELPERS ====================

/** Extracts base position from playerId: "KC-QB" → "QB", "DAL-WR1" → "WR" */
export function positionFromPlayerId(id: string): string {
  const pos = id.split('-')[1] || '';
  return pos.replace(/[0-9]/g, '');
}

/** Returns hex color for a position (handles WR1/WR2 → WR, RB1/RB2 → RB) */
export function getPositionColorHex(pos: string): string {
  const base = pos.replace(/[0-9]/g, '');
  return POSITION_COLORS[base] || '#888888';
}

// ==================== BYE WEEKS ====================
const BYE_WEEKS: Record<string, number> = {
  KC: 6, SF: 9, MIA: 10, DAL: 7, PHI: 5, BUF: 12, CIN: 12, DET: 5,
  BAL: 14, JAX: 12, LAC: 5, SEA: 10, GB: 10, NYJ: 12, MIN: 6, ATL: 12,
  CLE: 10, HOU: 14, LV: 10, TB: 11, CHI: 7, PIT: 9, DEN: 14, LAR: 6,
  NO: 12, TEN: 5, IND: 14, ARI: 11, WAS: 14, NYG: 11, CAR: 11, NE: 14,
};

// ==================== 224 PLAYER DATASET ====================
// 32 NFL teams × 7 positions each (QB, RB1, RB2, WR1, WR2, TE, DST)

export interface PlayerData {
  playerId: string;
  team: string;
  position: string;
  adp: number;
  rank: number;
  byeWeek: number;
  playersFromTeam: string[];
}

const TEAMS = [
  'KC', 'SF', 'MIA', 'DAL', 'PHI', 'BUF', 'CIN', 'DET',
  'BAL', 'JAX', 'LAC', 'SEA', 'GB', 'NYJ', 'MIN', 'ATL',
  'CLE', 'HOU', 'LV', 'TB', 'CHI', 'PIT', 'DEN', 'LAR',
  'NO', 'TEN', 'IND', 'ARI', 'WAS', 'NYG', 'CAR', 'NE',
];

const POSITIONS_PER_TEAM = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'DST'];

// Players from team mapping — full depth charts (3 players per position)
// Sourced from lib/mock/teamPositions.ts depthChartData. During filling phase these
// power the "Players from team" display. At 10/10, initializeFromServer replaces with server data.
const TEAM_PLAYERS: Record<string, Record<string, string[]>> = {
  KC: { QB: ['Patrick Mahomes', 'Carson Wentz', 'Chris Oladokun'], RB1: ['Isiah Pacheco', 'Kareem Hunt', 'Clyde Edwards-Helaire'], RB2: ['Kareem Hunt', 'Clyde Edwards-Helaire', 'Deneric Prince'], WR1: ['Xavier Worthy', 'Hollywood Brown', 'JuJu Smith-Schuster'], WR2: ['Hollywood Brown', 'JuJu Smith-Schuster', 'Skyy Moore'], TE: ['Travis Kelce', 'Noah Gray', 'Jared Wiley'], DST: ['KC Defense'] },
  SF: { QB: ['Brock Purdy', 'Sam Darnold', 'Brandon Allen'], RB1: ['Christian McCaffrey', 'Jordan Mason', 'Elijah Mitchell'], RB2: ['Jordan Mason', 'Elijah Mitchell', 'Patrick Taylor Jr'], WR1: ['Deebo Samuel', 'Brandon Aiyuk', 'Jauan Jennings'], WR2: ['Brandon Aiyuk', 'Jauan Jennings', 'Ricky Pearsall'], TE: ['George Kittle', 'Eric Saubert', 'Cameron Latu'], DST: ['SF Defense'] },
  MIA: { QB: ['Tua Tagovailoa', 'Mike White', 'Skylar Thompson'], RB1: ['De\'Von Achane', 'Raheem Mostert', 'Jeff Wilson Jr'], RB2: ['Raheem Mostert', 'Jeff Wilson Jr', 'Chris Brooks'], WR1: ['Tyreek Hill', 'Jaylen Waddle', 'River Cracraft'], WR2: ['Jaylen Waddle', 'River Cracraft', 'Braxton Berrios'], TE: ['Jonnu Smith', 'Durham Smythe', 'Julian Hill'], DST: ['MIA Defense'] },
  DAL: { QB: ['Dak Prescott', 'Cooper Rush', 'Trey Lance'], RB1: ['Rico Dowdle', 'Ezekiel Elliott', 'Deuce Vaughn'], RB2: ['Ezekiel Elliott', 'Deuce Vaughn', 'Snoop Conner'], WR1: ['CeeDee Lamb', 'Brandin Cooks', 'Jalen Tolbert'], WR2: ['Brandin Cooks', 'Jalen Tolbert', 'KaVontae Turpin'], TE: ['Jake Ferguson', 'Luke Schoonmaker', 'Peyton Hendershot'], DST: ['DAL Defense'] },
  PHI: { QB: ['Jalen Hurts', 'Kenny Pickett', 'Tanner McKee'], RB1: ['Saquon Barkley', 'Kenny Gainwell', 'Boston Scott'], RB2: ['Kenny Gainwell', 'Boston Scott', 'Tyrion Davis-Price'], WR1: ['A.J. Brown', 'DeVonta Smith', 'Britain Covey'], WR2: ['DeVonta Smith', 'Britain Covey', 'Parris Campbell'], TE: ['Dallas Goedert', 'Grant Calcaterra', 'Albert Okwuegbunam'], DST: ['PHI Defense'] },
  BUF: { QB: ['Josh Allen', 'Mitchell Trubisky', 'Shane Buechele'], RB1: ['James Cook', 'Ray Davis', 'Ty Johnson'], RB2: ['Ray Davis', 'Ty Johnson', 'Frank Gore Jr'], WR1: ['Khalil Shakir', 'Keon Coleman', 'Curtis Samuel'], WR2: ['Keon Coleman', 'Curtis Samuel', 'Mack Hollins'], TE: ['Dalton Kincaid', 'Dawson Knox', 'Quintin Morris'], DST: ['BUF Defense'] },
  CIN: { QB: ['Joe Burrow', 'Jake Browning', 'Logan Woodside'], RB1: ['Chase Brown', 'Zack Moss', 'Trayveon Williams'], RB2: ['Zack Moss', 'Trayveon Williams', 'Chris Evans'], WR1: ['Ja\'Marr Chase', 'Tee Higgins', 'Andrei Iosivas'], WR2: ['Tee Higgins', 'Andrei Iosivas', 'Trenton Irwin'], TE: ['Mike Gesicki', 'Drew Sample', 'Erick All Jr'], DST: ['CIN Defense'] },
  DET: { QB: ['Jared Goff', 'Hendon Hooker', 'Nate Sudfeld'], RB1: ['Jahmyr Gibbs', 'David Montgomery', 'Craig Reynolds'], RB2: ['David Montgomery', 'Craig Reynolds', 'Jermar Jefferson'], WR1: ['Amon-Ra St. Brown', 'Jameson Williams', 'Kalif Raymond'], WR2: ['Jameson Williams', 'Kalif Raymond', 'Tim Patrick'], TE: ['Sam LaPorta', 'Brock Wright', 'James Mitchell'], DST: ['DET Defense'] },
  BAL: { QB: ['Lamar Jackson', 'Tyler Huntley', 'Josh Johnson'], RB1: ['Derrick Henry', 'Justice Hill', 'Keaton Mitchell'], RB2: ['Justice Hill', 'Keaton Mitchell', 'Chris Collier'], WR1: ['Zay Flowers', 'Rashod Bateman', 'Nelson Agholor'], WR2: ['Rashod Bateman', 'Nelson Agholor', 'Tylan Wallace'], TE: ['Mark Andrews', 'Isaiah Likely', 'Charlie Kolar'], DST: ['BAL Defense'] },
  JAX: { QB: ['Trevor Lawrence', 'Mac Jones', 'C.J. Beathard'], RB1: ['Travis Etienne', 'Tank Bigsby', 'D\'Ernest Johnson'], RB2: ['Tank Bigsby', 'D\'Ernest Johnson', 'Snoop Conner'], WR1: ['Brian Thomas Jr', 'Gabe Davis', 'Tim Jones'], WR2: ['Gabe Davis', 'Tim Jones', 'Parker Washington'], TE: ['Evan Engram', 'Luke Farrell', 'Brenton Strange'], DST: ['JAX Defense'] },
  LAC: { QB: ['Justin Herbert', 'Easton Stick', 'Max Duggan'], RB1: ['J.K. Dobbins', 'Gus Edwards', 'Kimani Vidal'], RB2: ['Gus Edwards', 'Kimani Vidal', 'Hassan Haskins'], WR1: ['Quentin Johnston', 'Ladd McConkey', 'Joshua Palmer'], WR2: ['Ladd McConkey', 'Joshua Palmer', 'DJ Chark Jr'], TE: ['Will Dissly', 'Hayden Hurst', 'Stone Smartt'], DST: ['LAC Defense'] },
  SEA: { QB: ['Geno Smith', 'Sam Howell', 'P.J. Walker'], RB1: ['Kenneth Walker III', 'Zach Charbonnet', 'Kenny McIntosh'], RB2: ['Zach Charbonnet', 'Kenny McIntosh', 'George Holani'], WR1: ['DK Metcalf', 'Tyler Lockett', 'Jaxon Smith-Njigba'], WR2: ['Tyler Lockett', 'Jaxon Smith-Njigba', 'Jake Bobo'], TE: ['Noah Fant', 'Pharaoh Brown', 'Brady Russell'], DST: ['SEA Defense'] },
  GB: { QB: ['Jordan Love', 'Sean Clifford', 'Michael Pratt'], RB1: ['Josh Jacobs', 'Emanuel Wilson', 'AJ Dillon'], RB2: ['Emanuel Wilson', 'AJ Dillon', 'Chris Brooks'], WR1: ['Jayden Reed', 'Romeo Doubs', 'Christian Watson'], WR2: ['Romeo Doubs', 'Christian Watson', 'Dontayvion Wicks'], TE: ['Tucker Kraft', 'Luke Musgrave', 'Ben Sims'], DST: ['GB Defense'] },
  NYJ: { QB: ['Aaron Rodgers', 'Tyrod Taylor', 'Tim Boyle'], RB1: ['Breece Hall', 'Braelon Allen', 'Israel Abanikanda'], RB2: ['Braelon Allen', 'Israel Abanikanda', 'Zonovan Knight'], WR1: ['Garrett Wilson', 'Allen Lazard', 'Xavier Gipson'], WR2: ['Allen Lazard', 'Xavier Gipson', 'Malik Taylor'], TE: ['Tyler Conklin', 'Jeremy Ruckert', 'C.J. Uzomah'], DST: ['NYJ Defense'] },
  MIN: { QB: ['Sam Darnold', 'Nick Mullens', 'J.J. McCarthy'], RB1: ['Aaron Jones', 'Ty Chandler', 'Cam Akers'], RB2: ['Ty Chandler', 'Cam Akers', 'DeWayne McBride'], WR1: ['Justin Jefferson', 'Jordan Addison', 'Jalen Nailor'], WR2: ['Jordan Addison', 'Jalen Nailor', 'Brandon Powell'], TE: ['T.J. Hockenson', 'Josh Oliver', 'Johnny Mundt'], DST: ['MIN Defense'] },
  ATL: { QB: ['Kirk Cousins', 'Taylor Heinicke', 'Michael Penix Jr'], RB1: ['Bijan Robinson', 'Tyler Allgeier', 'Avery Williams'], RB2: ['Tyler Allgeier', 'Avery Williams', 'Carlos Washington Jr'], WR1: ['Drake London', 'Darnell Mooney', 'Ray-Ray McCloud'], WR2: ['Darnell Mooney', 'Ray-Ray McCloud', 'KhaDarel Hodge'], TE: ['Kyle Pitts', 'Charlie Woerner', 'Ross Dwelley'], DST: ['ATL Defense'] },
  CLE: { QB: ['Deshaun Watson', 'Jameis Winston', 'Dorian Thompson-Robinson'], RB1: ['Jerome Ford', 'Pierre Strong Jr', 'Kareem Hunt'], RB2: ['Pierre Strong Jr', 'John Kelly', 'Demetric Felton'], WR1: ['Amari Cooper', 'Jerry Jeudy', 'Elijah Moore'], WR2: ['Jerry Jeudy', 'Elijah Moore', 'Cedric Tillman'], TE: ['David Njoku', 'Harrison Bryant', 'Jordan Akins'], DST: ['CLE Defense'] },
  HOU: { QB: ['CJ Stroud', 'Davis Mills', 'Case Keenum'], RB1: ['Joe Mixon', 'Dameon Pierce', 'Dare Ogunbowale'], RB2: ['Dameon Pierce', 'Dare Ogunbowale', 'J.J. Taylor'], WR1: ['Nico Collins', 'Stefon Diggs', 'Tank Dell'], WR2: ['Stefon Diggs', 'Tank Dell', 'Robert Woods'], TE: ['Dalton Schultz', 'Brevin Jordan', 'Cade Stover'], DST: ['HOU Defense'] },
  LV: { QB: ['Gardner Minshew', 'Aidan O\'Connell', 'Nathan Peterman'], RB1: ['Zamir White', 'Alexander Mattison', 'Ameer Abdullah'], RB2: ['Alexander Mattison', 'Ameer Abdullah', 'Sincere McCormick'], WR1: ['Davante Adams', 'Jakobi Meyers', 'Tre Tucker'], WR2: ['Jakobi Meyers', 'Tre Tucker', 'Michael Gallup'], TE: ['Brock Bowers', 'Michael Mayer', 'Harrison Bryant'], DST: ['LV Defense'] },
  TB: { QB: ['Baker Mayfield', 'Kyle Trask', 'John Wolford'], RB1: ['Bucky Irving', 'Rachaad White', 'Sean Tucker'], RB2: ['Rachaad White', 'Sean Tucker', 'Chase Edmonds'], WR1: ['Mike Evans', 'Chris Godwin', 'Jalen McMillan'], WR2: ['Chris Godwin', 'Jalen McMillan', 'Rakim Jarrett'], TE: ['Cade Otton', 'Ko Kieft', 'Payne Durham'], DST: ['TB Defense'] },
  CHI: { QB: ['Caleb Williams', 'Tyson Bagent', 'Brett Rypien'], RB1: ['D\'Andre Swift', 'Roschon Johnson', 'Khalil Herbert'], RB2: ['Roschon Johnson', 'Khalil Herbert', 'Travis Homer'], WR1: ['DJ Moore', 'Keenan Allen', 'Rome Odunze'], WR2: ['Keenan Allen', 'Rome Odunze', 'Velus Jones Jr'], TE: ['Cole Kmet', 'Gerald Everett', 'Tommy Sweeney'], DST: ['CHI Defense'] },
  PIT: { QB: ['Russell Wilson', 'Justin Fields', 'Kyle Allen'], RB1: ['Najee Harris', 'Jaylen Warren', 'Cordarrelle Patterson'], RB2: ['Jaylen Warren', 'Cordarrelle Patterson', 'Jonathan Ward'], WR1: ['George Pickens', 'Van Jefferson', 'Calvin Austin III'], WR2: ['Van Jefferson', 'Calvin Austin III', 'Roman Wilson'], TE: ['Pat Freiermuth', 'Darnell Washington', 'MyCole Pruitt'], DST: ['PIT Defense'] },
  DEN: { QB: ['Bo Nix', 'Jarrett Stidham', 'Ben DiNucci'], RB1: ['Javonte Williams', 'Jaleel McLaughlin', 'Samaje Perine'], RB2: ['Jaleel McLaughlin', 'Samaje Perine', 'Blake Watson'], WR1: ['Courtland Sutton', 'Josh Reynolds', 'Marvin Mims Jr'], WR2: ['Josh Reynolds', 'Marvin Mims Jr', 'Tim Patrick'], TE: ['Adam Trautman', 'Greg Dulcich', 'Lucas Krull'], DST: ['DEN Defense'] },
  LAR: { QB: ['Matthew Stafford', 'Jimmy Garoppolo', 'Stetson Bennett'], RB1: ['Kyren Williams', 'Blake Corum', 'Ronnie Rivers'], RB2: ['Blake Corum', 'Ronnie Rivers', 'Boston Scott'], WR1: ['Puka Nacua', 'Cooper Kupp', 'Demarcus Robinson'], WR2: ['Cooper Kupp', 'Demarcus Robinson', 'Tyler Johnson'], TE: ['Tyler Higbee', 'Colby Parkinson', 'Hunter Long'], DST: ['LAR Defense'] },
  NO: { QB: ['Derek Carr', 'Jameis Winston', 'Jake Haener'], RB1: ['Alvin Kamara', 'Jamaal Williams', 'Kendre Miller'], RB2: ['Jamaal Williams', 'Kendre Miller', 'Jordan Mims'], WR1: ['Chris Olave', 'Rashid Shaheed', 'AT Perry'], WR2: ['Rashid Shaheed', 'AT Perry', 'Cedrick Wilson Jr'], TE: ['Taysom Hill', 'Juwan Johnson', 'Foster Moreau'], DST: ['NO Defense'] },
  TEN: { QB: ['Will Levis', 'Mason Rudolph', 'Malik Willis'], RB1: ['Tony Pollard', 'Tyjae Spears', 'Joshua Kelley'], RB2: ['Tyjae Spears', 'Joshua Kelley', 'Julius Chestnut'], WR1: ['DeAndre Hopkins', 'Calvin Ridley', 'Tyler Boyd'], WR2: ['Calvin Ridley', 'Tyler Boyd', 'Treylon Burks'], TE: ['Chigoziem Okonkwo', 'Josh Whyle', 'Nick Vannett'], DST: ['TEN Defense'] },
  IND: { QB: ['Anthony Richardson', 'Joe Flacco', 'Sam Ehlinger'], RB1: ['Jonathan Taylor', 'Trey Sermon', 'Evan Hull'], RB2: ['Trey Sermon', 'Evan Hull', 'Tyler Goodson'], WR1: ['Michael Pittman Jr', 'Josh Downs', 'Adonai Mitchell'], WR2: ['Josh Downs', 'Adonai Mitchell', 'Ashton Dulin'], TE: ['Mo Alie-Cox', 'Kylen Granson', 'Jelani Woods'], DST: ['IND Defense'] },
  ARI: { QB: ['Kyler Murray', 'Clayton Tune', 'Jeff Driskel'], RB1: ['James Conner', 'Trey Benson', 'Emari Demercado'], RB2: ['Trey Benson', 'Emari Demercado', 'Michael Carter'], WR1: ['Marvin Harrison Jr', 'Michael Wilson', 'Greg Dortch'], WR2: ['Michael Wilson', 'Greg Dortch', 'Zay Jones'], TE: ['Trey McBride', 'Elijah Higgins', 'Geoff Swaim'], DST: ['ARI Defense'] },
  WAS: { QB: ['Jayden Daniels', 'Marcus Mariota', 'Jeff Driskel'], RB1: ['Brian Robinson Jr', 'Austin Ekeler', 'Chris Rodriguez Jr'], RB2: ['Austin Ekeler', 'Chris Rodriguez Jr', 'Jeremy McNichols'], WR1: ['Terry McLaurin', 'Jahan Dotson', 'Olamide Zaccheaus'], WR2: ['Jahan Dotson', 'Olamide Zaccheaus', 'Dyami Brown'], TE: ['Zach Ertz', 'John Bates', 'Ben Sinnott'], DST: ['WAS Defense'] },
  NYG: { QB: ['Daniel Jones', 'Drew Lock', 'Tommy DeVito'], RB1: ['Devin Singletary', 'Tyrone Tracy Jr', 'Eric Gray'], RB2: ['Tyrone Tracy Jr', 'Eric Gray', 'Jashaun Corbin'], WR1: ['Malik Nabers', 'Darius Slayton', 'Wan\'Dale Robinson'], WR2: ['Darius Slayton', 'Wan\'Dale Robinson', 'Jalin Hyatt'], TE: ['Daniel Bellinger', 'Theo Johnson', 'Chris Manhertz'], DST: ['NYG Defense'] },
  CAR: { QB: ['Bryce Young', 'Andy Dalton', 'Matt Corral'], RB1: ['Chuba Hubbard', 'Miles Sanders', 'Raheem Blackshear'], RB2: ['Miles Sanders', 'Raheem Blackshear', 'Spencer Brown'], WR1: ['Diontae Johnson', 'Adam Thielen', 'Jonathan Mingo'], WR2: ['Adam Thielen', 'Jonathan Mingo', 'Xavier Legette'], TE: ['Tommy Tremble', 'Ian Thomas', 'Ja\'Tavion Sanders'], DST: ['CAR Defense'] },
  NE: { QB: ['Drake Maye', 'Jacoby Brissett', 'Bailey Zappe'], RB1: ['Rhamondre Stevenson', 'Antonio Gibson', 'Kevin Harris'], RB2: ['Antonio Gibson', 'Kevin Harris', 'JaMycal Hasty'], WR1: ['Ja\'Lynn Polk', 'DeMario Douglas', 'Kendrick Bourne'], WR2: ['DeMario Douglas', 'Kendrick Bourne', 'K.J. Osborn'], TE: ['Hunter Henry', 'Austin Hooper', 'Jaheim Bell'], DST: ['NE Defense'] },
};

function generateAllPositions(): PlayerData[] {
  const players: PlayerData[] = [];
  let adpCounter = 1;
  let rankCounter = 1;

  // Generate players in a realistic ADP order by position tiers
  // Tier 1: Top QBs, RB1s, WR1s
  const adpOrder: { team: string; pos: string }[] = [];

  // Generate all 224 player slots
  for (const team of TEAMS) {
    for (const pos of POSITIONS_PER_TEAM) {
      adpOrder.push({ team, pos });
    }
  }

  // Sort by a realistic ADP ranking: key positions first, DST last
  const positionPriority: Record<string, number> = {
    QB: 2, RB1: 1, RB2: 4, WR1: 1, WR2: 3, TE: 5, DST: 6,
  };

  // Generate a deterministic but varied ADP order
  // Top teams' key positions get low ADPs
  const teamTier: Record<string, number> = {};
  TEAMS.forEach((t, i) => { teamTier[t] = i; });

  adpOrder.sort((a, b) => {
    const aPri = (positionPriority[a.pos] || 6) * 32 + (teamTier[a.team] || 0);
    const bPri = (positionPriority[b.pos] || 6) * 32 + (teamTier[b.team] || 0);
    return aPri - bPri;
  });

  for (const entry of adpOrder) {
    const playerId = `${entry.team}-${entry.pos}`;
    const teamPlayers = TEAM_PLAYERS[entry.team];
    const posPlayers = teamPlayers?.[entry.pos] || [`${entry.team} ${entry.pos}`];

    players.push({
      playerId,
      team: entry.team,
      position: entry.pos,
      adp: adpCounter,
      rank: rankCounter,
      byeWeek: BYE_WEEKS[entry.team] || 7,
      playersFromTeam: posPlayers,
    });
    adpCounter++;
    rankCounter++;
  }

  return players;
}

export const ALL_POSITIONS: PlayerData[] = generateAllPositions();

// ==================== DRAFT PLAYERS ====================
export const DRAFT_PLAYERS = [
  { id: '1', name: 'You', displayName: 'You', isYou: true, avatar: '🍌' },
  { id: '2', name: 'GridironKing', displayName: 'GridironKing', isYou: false, avatar: '🍌' },
  { id: '3', name: 'TouchdownTitan', displayName: 'TD Titan', isYou: false, avatar: '🍌' },
  { id: '4', name: 'Diamond', displayName: 'Diamond', isYou: false, avatar: '🍌' },
  { id: '5', name: 'MoonBoi', displayName: 'MoonBoi', isYou: false, avatar: '🍌' },
  { id: '6', name: 'BlitzMaster', displayName: 'BlitzMaster', isYou: false, avatar: '🍌' },
  { id: '7', name: 'EndZoneKing', displayName: 'EndZoneKing', isYou: false, avatar: '🍌' },
  { id: '8', name: 'Holder', displayName: 'Holder', isYou: false, avatar: '🍌' },
  { id: '9', name: 'Gridiron', displayName: 'Gridiron', isYou: false, avatar: '🍌' },
  { id: '10', name: 'DraftKing', displayName: 'DraftKing', isYou: false, avatar: '🍌' },
];

export const DRAFT_TYPES = {
  jackpot: { label: 'JACKPOT', color: '#ef4444', bgClass: 'bg-red-600' },
  hof: { label: 'HALL OF FAME', color: '#D4AF37', bgClass: 'bg-yellow-600' },
  pro: { label: 'PRO', color: '#a855f7', bgClass: 'bg-purple-600' },
};

export const TOTAL_ROUNDS = 15;
export const TOTAL_PICKS = TOTAL_ROUNDS * 10; // 150

// ==================== TAILWIND-COMPATIBLE POSITION COLORS ====================
export function getPositionColor(pos: string) {
  const base = pos.replace(/[0-9]/g, '');
  switch (base) {
    case 'QB': return { bg: 'bg-[#FF474C]', text: 'text-[#FF474C]', light: 'bg-[#FF474C]/20' };
    case 'RB': return { bg: 'bg-[#3c9120]', text: 'text-[#3c9120]', light: 'bg-[#3c9120]/20' };
    case 'WR': return { bg: 'bg-[#cb6ce6]', text: 'text-[#cb6ce6]', light: 'bg-[#cb6ce6]/20' };
    case 'TE': return { bg: 'bg-[#326cf8]', text: 'text-[#326cf8]', light: 'bg-[#326cf8]/20' };
    case 'DST': return { bg: 'bg-[#DF893E]', text: 'text-[#DF893E]', light: 'bg-[#DF893E]/20' };
    default: return { bg: 'bg-gray-500', text: 'text-gray-400', light: 'bg-gray-500/20' };
  }
}

// ==================== SLOT MACHINE HELPERS ====================
export function generateReelItemsForReel(resultType: DraftType, reelIndex: number, totalItems: number = 50): DraftType[] {
  const items: DraftType[] = [];
  for (let i = 0; i < totalItems; i++) {
    const rand = Math.random();
    if (rand < 0.15) items.push('jackpot');
    else if (rand < 0.35) items.push('hof');
    else items.push('pro');
  }
  const landingIndex = totalItems - 8;
  items[landingIndex] = resultType;
  if (reelIndex === 2 && resultType === 'pro') {
    items[landingIndex - 1] = 'jackpot';
  }
  return items;
}

export function generateReelResults(): DraftType[] {
  // TEST MODE: Force jackpot for testing - change back to random later
  return ['jackpot', 'jackpot', 'jackpot'];

  /* REAL ODDS - uncomment for production:
  const results: DraftType[] = [];
  for (let i = 0; i < 3; i++) {
    const rand = Math.random();
    if (rand < 0.01) results.push('jackpot');
    else if (rand < 0.06) results.push('hof');
    else results.push('pro');
  }
  if (results.every(r => r === 'pro')) {
    const randomIndex = Math.floor(Math.random() * 3);
    (results as DraftType[])[randomIndex] = Math.random() < 0.33 ? 'jackpot' : 'hof';
  }
  return results;
  */
}

// ==================== DRAFT PICK INTERFACE ====================
export interface DraftPick {
  pickNumber: number;
  round: number;
  pickInRound: number;
  ownerName: string;
  ownerIndex: number;
  playerId: string;
  position: string;
  team: string;
}

// Legacy Pick interface for slot machine overlay compatibility
export interface Pick {
  round: number;
  pickInRound: number;
  overallPick: number;
  playerId: string;
  selection: { id: string; team: string; position: string; adp: number };
}

// ==================== ROSTER TYPE ====================
export interface PositionRoster {
  QB: string[];
  RB: string[];
  WR: string[];
  TE: string[];
  DST: string[];
}
