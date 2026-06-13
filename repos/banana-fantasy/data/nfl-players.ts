// NFL player data — 32 teams x 7 positions (224 players)
// Extracted from lib/draftRoomConstants.ts

export interface PlayerData {
  playerId: string;
  team: string;
  position: string;
  adp: number;
  rank: number;
  byeWeek: number;
  playersFromTeam: string[];
}

// ==================== BYE WEEKS ====================
const BYE_WEEKS: Record<string, number> = {
  KC: 5, SF: 8, MIA: 6, DAL: 14, PHI: 10, BUF: 7, CIN: 6, DET: 6,
  BAL: 13, JAX: 7, LAC: 7, SEA: 11, GB: 11, NYJ: 13, MIN: 6, ATL: 11,
  CLE: 11, HOU: 8, LV: 13, TB: 10, CHI: 10, PIT: 9, DEN: 10, LAR: 11,
  NO: 8, TEN: 9, IND: 13, ARI: 14, WAS: 7, NYG: 8, CAR: 5, NE: 11,
};

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
  KC: { QB: ['Patrick Mahomes', 'Chris Oladokun', 'Shane Buechele'], RB1: ['Isiah Pacheco', 'Kareem Hunt', 'Brashard Smith'], RB2: ['Kareem Hunt', 'Brashard Smith', 'Dameon Pierce'], WR1: ['Rashee Rice', 'Xavier Worthy', 'JuJu Smith-Schuster'], WR2: ['Xavier Worthy', 'JuJu Smith-Schuster', 'Hollywood Brown'], TE: ['Travis Kelce', 'Noah Gray', 'Jared Wiley'], DST: ['KC Defense'] },
  SF: { QB: ['Brock Purdy', 'Mac Jones', 'Kurtis Rourke'], RB1: ['Christian McCaffrey', 'Isaac Guerendo', 'Brian Robinson'], RB2: ['Isaac Guerendo', 'Brian Robinson', 'Jordan James'], WR1: ['Brandon Aiyuk', 'Ricky Pearsall', 'Jauan Jennings'], WR2: ['Ricky Pearsall', 'Jauan Jennings', 'Jacob Cowing'], TE: ['George Kittle', 'Jake Tonges', 'Luke Farrell'], DST: ['SF Defense'] },
  MIA: { QB: ['Tua Tagovailoa', 'Quinn Ewers', 'Zach Wilson'], RB1: ['De\'von Achane', 'Jaylen Wright', 'Ollie Gordon'], RB2: ['Jaylen Wright', 'Ollie Gordon', 'Donovan Edwards'], WR1: ['Tyreek Hill', 'Jaylen Waddle', 'Malik Washington'], WR2: ['Jaylen Waddle', 'Malik Washington', 'Cedrick Wilson Jr.'], TE: ['Julian Hill', 'Greg Dulcich', 'Darren Waller'], DST: ['MIA Defense'] },
  DAL: { QB: ['Dak Prescott', 'Joe Milton'], RB1: ['Jaydon Blue', 'Phil Mafah', 'Javonte Williams'], RB2: ['Phil Mafah', 'Javonte Williams', 'Malik Davis'], WR1: ['Jalen Tolbert', 'KaVontae Turpin', 'Ryan Flournoy'], WR2: ['KaVontae Turpin', 'Ryan Flournoy', 'CeeDee Lamb'], TE: ['Jake Ferguson', 'Luke Schoonmaker', 'Brevyn Spann-ford'], DST: ['DAL Defense'] },
  PHI: { QB: ['Jalen Hurts', 'Tanner Mckee', 'Sam Howell'], RB1: ['Saquon Barkley', 'Will Shipley', 'Tank Bigsby'], RB2: ['Will Shipley', 'Tank Bigsby', 'A.J. Dillon'], WR1: ['A.J. Brown', 'DeVonta Smith', 'Jahan Dotson'], WR2: ['DeVonta Smith', 'Jahan Dotson', 'Johnny Wilson'], TE: ['Dallas Goedert', 'Grant Calcaterra', 'Kylen Granson'], DST: ['PHI Defense'] },
  BUF: { QB: ['Josh Allen', 'Mitchell Trubisky'], RB1: ['James Cook', 'Ray Davis', 'Ty Johnson'], RB2: ['Ray Davis', 'Ty Johnson', 'Frank Gore'], WR1: ['Curtis Samuel', 'Khalil Shakir', 'Keon Coleman'], WR2: ['Khalil Shakir', 'Keon Coleman', 'Brandin Cooks'], TE: ['Dalton Kincaid', 'Dawson Knox', 'Jackson Hawes'], DST: ['BUF Defense'] },
  CIN: { QB: ['Joe Burrow', 'Jake Browning', 'Joe Flacco'], RB1: ['Chase Brown', 'Samaje Perine', 'Tahj Brooks'], RB2: ['Samaje Perine', 'Tahj Brooks'], WR1: ['Ja\'Marr Chase', 'Tee Higgins', 'Andrei Iosivas'], WR2: ['Tee Higgins', 'Andrei Iosivas', 'Mitchell Tinsley'], TE: ['Mike Gesicki', 'Tanner Hudson', 'Noah Fant'], DST: ['CIN Defense'] },
  DET: { QB: ['Jared Goff', 'Kyle Allen'], RB1: ['Jahmyr Gibbs', 'David Montgomery', 'Sione Vaki'], RB2: ['David Montgomery', 'Sione Vaki', 'Jacob Saylors'], WR1: ['Amon-Ra St. Brown', 'Jameson Williams', 'Kalif Raymond'], WR2: ['Jameson Williams', 'Kalif Raymond', 'Isaac Teslaa'], TE: ['Sam Laporta', 'Shane Zylstra', 'Anthony Firkser'], DST: ['DET Defense'] },
  BAL: { QB: ['Lamar Jackson', 'Tyler Huntley', 'Cooper Rush'], RB1: ['Derrick Henry', 'Justice Hill', 'Rasheen Ali'], RB2: ['Justice Hill', 'Rasheen Ali', 'Keaton Mitchell'], WR1: ['Zay Flowers', 'Rashod Bateman', 'Devontez Walker'], WR2: ['Rashod Bateman', 'Devontez Walker', 'DeAndre Hopkins'], TE: ['Mark Andrews', 'Isaiah Likely', 'Charlie Kolar'], DST: ['BAL Defense'] },
  JAX: { QB: ['Trevor Lawrence', 'Nick Mullens'], RB1: ['Travis Etienne Jr.', 'Bhayshul Tuten', 'Lequint Allen'], RB2: ['Bhayshul Tuten', 'Lequint Allen', 'DeeJay Dallas'], WR1: ['Brian Thomas Jr.', 'Parker Washington', 'Jakobi Meyers'], WR2: ['Parker Washington', 'Jakobi Meyers', 'Tim Patrick'], TE: ['Brenton Strange', 'Johnny Mundt', 'Quintin Morris'], DST: ['JAX Defense'] },
  LAC: { QB: ['Justin Herbert', 'Trey Lance'], RB1: ['Kimani Vidal', 'Jaret Patterson', 'Omarion Hampton'], RB2: ['Jaret Patterson', 'Omarion Hampton', 'Hassan Haskins'], WR1: ['Ladd Mcconkey', 'Quentin Johnston', 'Keenan Allen'], WR2: ['Quentin Johnston', 'Keenan Allen', 'Tre Harris'], TE: ['Will Dissly', 'Oronde Gadsden', 'Tucker Fisk'], DST: ['LAC Defense'] },
  SEA: { QB: ['Sam Darnold', 'Drew Lock', 'Jalen Milroe'], RB1: ['Kenneth Walker', 'George Holani', 'Velus Jones Jr.'], RB2: ['George Holani', 'Velus Jones Jr.', 'Cam Akers'], WR1: ['Jaxon Smith-njigba', 'Jake Bobo', 'Cooper Kupp'], WR2: ['Jake Bobo', 'Cooper Kupp', 'Rashid Shaheed'], TE: ['Aj Barner', 'Elijah Arroyo', 'Eric Saubert'], DST: ['SEA Defense'] },
  GB: { QB: ['Jordan Love', 'Malik Willis', 'Desmond Ridder'], RB1: ['Josh Jacobs', 'Emanuel Wilson', 'Marshawn Lloyd'], RB2: ['Emanuel Wilson', 'Marshawn Lloyd', 'Chris Brooks'], WR1: ['Jayden Reed', 'Christian Watson', 'Romeo Doubs'], WR2: ['Christian Watson', 'Romeo Doubs', 'Dontayvion Wicks'], TE: ['Luke Musgrave', 'Tucker Kraft', 'Josh Whyle'], DST: ['GB Defense'] },
  NYJ: { QB: ['Tyrod Taylor', 'Brady Cook', 'Hendon Hooker'], RB1: ['Breece Hall', 'Khalil Herbert', 'Kene Nwangwu'], RB2: ['Khalil Herbert', 'Kene Nwangwu', 'Raheem Blackshear'], WR1: ['Garrett Wilson', 'John Metchie', 'Adonai Mitchell'], WR2: ['John Metchie', 'Adonai Mitchell', 'Isaiah Williams'], TE: ['Jeremy Ruckert', 'Stone Smartt', 'Jelani Woods'], DST: ['NYJ Defense'] },
  MIN: { QB: ['Brett Rypien', 'J.j. Mccarthy', 'Max Brosmer'], RB1: ['Aaron Jones', 'Ty Chandler', 'Jordan Mason'], RB2: ['Ty Chandler', 'Jordan Mason', 'Zavier Scott'], WR1: ['Justin Jefferson', 'Jordan Addison', 'Jalen Nailor'], WR2: ['Jordan Addison', 'Jalen Nailor', 'Tai Felton'], TE: ['Josh Oliver', 'T.J. Hockenson', 'Ben Yurosek'], DST: ['MIN Defense'] },
  ATL: { QB: ['Kirk Cousins', 'Michael Penix Jr.', 'Easton Stick'], RB1: ['Bijan Robinson', 'Tyler Allgeier', 'Nathan Carter'], RB2: ['Tyler Allgeier', 'Nathan Carter'], WR1: ['Drake London', 'Darnell Mooney', 'Khadarel Hodge'], WR2: ['Darnell Mooney', 'Khadarel Hodge', 'Casey Washington'], TE: ['Kyle Pitts', 'Charlie Woerner', 'Teagan Quitoriano'], DST: ['ATL Defense'] },
  CLE: { QB: ['Deshaun Watson', 'Shedeur Sanders', 'Dillon Gabriel'], RB1: ['Dylan Sampson', 'Raheim Sanders', 'Trayveon Williams'], RB2: ['Raheim Sanders', 'Trayveon Williams', 'Quinshon Judkins'], WR1: ['Jerry Jeudy', 'Cedric Tillman', 'Isaiah Bond'], WR2: ['Cedric Tillman', 'Isaiah Bond', 'Malachi Corley'], TE: ['David Njoku', 'Blake Whiteheart', 'Harold Fannin Jr.'], DST: ['CLE Defense'] },
  HOU: { QB: ['C.j. Stroud', 'Davis Mills', 'Graham Mertz'], RB1: ['Dare Ogunbowale', 'Woody Marks', 'Jawhar Jordan'], RB2: ['Woody Marks', 'Jawhar Jordan', 'Nick Chubb'], WR1: ['Nico Collins', 'Tank Dell', 'Jayden Higgins'], WR2: ['Tank Dell', 'Jayden Higgins', 'Christian Kirk'], TE: ['Dalton Schultz', 'Cade Stover', 'Brevin Jordan'], DST: ['HOU Defense'] },
  LV: { QB: ['Aidan O\'connell', 'Geno Smith', 'Kenny Pickett'], RB1: ['Zamir White', 'Dylan Laube', 'Ashton Jeanty'], RB2: ['Dylan Laube', 'Ashton Jeanty', 'Raheem Mostert'], WR1: ['Tre Tucker', 'Jack Bech', 'Dont\'e Thornton Jr.'], WR2: ['Jack Bech', 'Dont\'e Thornton Jr.', 'Tyler Lockett'], TE: ['Brock Bowers', 'Michael Mayer', 'Ian Thomas'], DST: ['LV Defense'] },
  TB: { QB: ['Baker Mayfield', 'Teddy Bridgewater', 'Connor Bazelak'], RB1: ['Rachaad White', 'Bucky Irving', 'Sean Tucker'], RB2: ['Bucky Irving', 'Sean Tucker'], WR1: ['Mike Evans', 'Chris Godwin', 'Jalen Mcmillan'], WR2: ['Chris Godwin', 'Jalen Mcmillan', 'Sterling Shepard'], TE: ['Cade Otton', 'Devin Culp', 'Payne Durham'], DST: ['TB Defense'] },
  CHI: { QB: ['Caleb Williams', 'Tyson Bagent', 'Case Keenum'], RB1: ['D\'Andre Swift', 'Roschon Johnson', 'Travis Homer'], RB2: ['Roschon Johnson', 'Travis Homer', 'Kyle Monangai'], WR1: ['DJ Moore', 'Rome Odunze', 'Luther Burden'], WR2: ['Rome Odunze', 'Luther Burden', 'Olamide Zaccheaus'], TE: ['Cole Kmet', 'Colston Loveland', 'Durham Smythe'], DST: ['CHI Defense'] },
  PIT: { QB: ['Aaron Rodgers', 'Mason Rudolph', 'Will Howard'], RB1: ['Jaylen Warren', 'Kenneth Gainwell', 'Kaleb Johnson'], RB2: ['Kenneth Gainwell', 'Kaleb Johnson'], WR1: ['Roman Wilson', 'Calvin Austin', 'D.K. Metcalf'], WR2: ['Calvin Austin', 'D.K. Metcalf', 'Adam Thielen'], TE: ['Pat Freiermuth', 'Darnell Washington', 'Connor Heyward'], DST: ['PIT Defense'] },
  DEN: { QB: ['Bo Nix', 'Jarrett Stidham', 'Sam Ehlinger'], RB1: ['Jaleel Mclaughlin', 'Rj Harvey', 'Tyler Badie'], RB2: ['Rj Harvey', 'Tyler Badie', 'J.K. Dobbins'], WR1: ['Courtland Sutton', 'Marvin Mims Jr.', 'Troy Franklin'], WR2: ['Marvin Mims Jr.', 'Troy Franklin', 'Pat Bryant'], TE: ['Adam Trautman', 'Evan Engram', 'Nate Adkins'], DST: ['DEN Defense'] },
  LAR: { QB: ['Matthew Stafford', 'Stetson Bennett', 'Jimmy Garoppolo'], RB1: ['Kyren Williams', 'Blake Corum', 'Ronnie Rivers'], RB2: ['Blake Corum', 'Ronnie Rivers', 'Jarquez Hunter'], WR1: ['Puka Nacua', 'Tutu Atwell', 'Jordan Whittington'], WR2: ['Tutu Atwell', 'Jordan Whittington', 'Davante Adams'], TE: ['Colby Parkinson', 'Davis Allen', 'Tyler Higbee'], DST: ['LAR Defense'] },
  NO: { QB: ['Taysom Hill', 'Spencer Rattler', 'Tyler Shough'], RB1: ['Alvin Kamara', 'Audric Estime', 'Evan Hull'], RB2: ['Audric Estime', 'Evan Hull', 'Nyheim Miller-Hines'], WR1: ['Chris Olave', 'Bub Means', 'Kevin Austin Jr.'], WR2: ['Bub Means', 'Kevin Austin Jr.', 'Dante Pettis'], TE: ['Juwan Johnson', 'Taysom Hill', 'Moliki Matavao'], DST: ['NO Defense'] },
  TEN: { QB: ['Will Levis', 'Jihad Ward', 'Brandon Allen'], RB1: ['Tony Pollard', 'Tyjae Spears', 'Julius Chestnut'], RB2: ['Tyjae Spears', 'Julius Chestnut', 'Kalel Mullings'], WR1: ['Calvin Ridley', 'Elic Ayomanor', 'Chimere Dike'], WR2: ['Elic Ayomanor', 'Chimere Dike', 'James Proche'], TE: ['Chigoziem Okonkwo', 'Gunnar Helm', 'David Martin-robinson'], DST: ['TEN Defense'] },
  IND: { QB: ['Anthony Richardson', 'Riley Leonard', 'Seth Henigan'], RB1: ['Jonathan Taylor', 'Tyler Goodson', 'Ameer Abdullah'], RB2: ['Tyler Goodson', 'Ameer Abdullah', 'Dj Giddens'], WR1: ['Michael Pittman', 'Josh Downs', 'Alec Pierce'], WR2: ['Josh Downs', 'Alec Pierce', 'Ashton Dulin'], TE: ['Mo Alie-Cox', 'Will Mallory', 'Tyler Warren'], DST: ['IND Defense'] },
  ARI: { QB: ['Kyler Murray', 'Jacoby Brissett', 'Kedon Slovis'], RB1: ['James Conner', 'Michael Carter', 'Emari Demercado'], RB2: ['Michael Carter', 'Emari Demercado', 'Corey Kiner'], WR1: ['Marvin Harrison Jr.', 'Michael Wilson', 'Greg Dortch'], WR2: ['Michael Wilson', 'Greg Dortch', 'Xavier Weaver'], TE: ['Trey McBride', 'Elijah Higgins', 'Josiah Deguara'], DST: ['ARI Defense'] },
  WAS: { QB: ['Marcus Mariota', 'Jeff Driskel', 'Josh Johnson'], RB1: ['Chris Rodriguez Jr.', 'Jeremy McNichols', 'Jacory Croskey-merritt'], RB2: ['Jeremy McNichols', 'Jacory Croskey-merritt', 'Chase Edmonds'], WR1: ['Terry McLaurin', 'Noah Brown', 'Luke Mccaffrey'], WR2: ['Noah Brown', 'Luke Mccaffrey', 'Deebo Samuel'], TE: ['Ben Sinnott', 'Zach Ertz', 'John Bates'], DST: ['WAS Defense'] },
  NYG: { QB: ['Jaxson Dart', 'Jameis Winston', 'Russell Wilson'], RB1: ['Devin Singletary', 'Tyrone Tracy Jr.', 'Eric Gray'], RB2: ['Tyrone Tracy Jr.', 'Eric Gray', 'Dante Miller'], WR1: ['Malik Nabers', 'Wan\'Dale Robinson', 'Darius Slayton'], WR2: ['Wan\'Dale Robinson', 'Darius Slayton', 'Jalin Hyatt'], TE: ['Daniel Bellinger', 'Theo Johnson', 'Chris Manhertz'], DST: ['NYG Defense'] },
  CAR: { QB: ['Bryce Young', 'Andy Dalton'], RB1: ['Chuba Hubbard', 'Rico Dowdle', 'Trevor Etienne'], RB2: ['Rico Dowdle', 'Trevor Etienne', 'Jonathon Brooks'], WR1: ['Xavier Legette', 'David Moore', 'Tetairoa Mcmillan'], WR2: ['David Moore', 'Tetairoa Mcmillan', 'Jalen Coker'], TE: ['Ja\'tavion Sanders', 'Tommy Tremble', 'Mitchell Evans'], DST: ['CAR Defense'] },
  NE: { QB: ['Drake Maye', 'Joshua Dobbs', 'Tommy Devito'], RB1: ['Rhamondre Stevenson', 'Antonio Gibson', 'Treveyon Henderson'], RB2: ['Antonio Gibson', 'Treveyon Henderson', 'D\'Ernest Johnson'], WR1: ['Demario Douglas', 'Stefon Diggs', 'Kayshon Boutte'], WR2: ['Stefon Diggs', 'Kayshon Boutte', 'Mack Hollins'], TE: ['Hunter Henry', 'Austin Hooper', 'Cj Dippre'], DST: ['NE Defense'] },
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

  // Match the backend's ranking order: SF-RB1 first, then WR1-heavy top picks
  // The backend ranks by projected points — WR1s dominate the top, RB1s mixed in
  // This hardcoded order matches the staging API's /draft/{id}/playerState/ response
  const topOrder: { team: string; pos: string }[] = [
    { team: 'SF', pos: 'RB1' },   // 1
    { team: 'DAL', pos: 'WR1' },  // 2
    { team: 'MIA', pos: 'WR1' },  // 3
    { team: 'CIN', pos: 'WR1' },  // 4
    { team: 'MIN', pos: 'WR1' },  // 5
    { team: 'DET', pos: 'WR1' },  // 6
    { team: 'ATL', pos: 'RB1' },  // 7
    { team: 'NYJ', pos: 'RB1' },  // 8
    { team: 'PHI', pos: 'WR1' },  // 9
    { team: 'BUF', pos: 'QB' },   // 10
    { team: 'KC', pos: 'QB' },    // 11
    { team: 'BAL', pos: 'QB' },   // 12
    { team: 'HOU', pos: 'WR1' },  // 13
    { team: 'SEA', pos: 'WR1' },  // 14
    { team: 'GB', pos: 'WR1' },   // 15
    { team: 'CLE', pos: 'RB1' },  // 16
    { team: 'JAX', pos: 'RB1' },  // 17
    { team: 'PHI', pos: 'QB' },   // 18
    { team: 'DEN', pos: 'RB1' },  // 19
    { team: 'KC', pos: 'TE' },    // 20
  ];

  // Put top picks first, then everything else sorted by position priority
  const topSet = new Set(topOrder.map(e => `${e.team}-${e.pos}`));
  const remaining = adpOrder.filter(e => !topSet.has(`${e.team}-${e.pos}`));

  // Sort remaining by position priority then team
  const posPri: Record<string, number> = { RB1: 0, WR1: 1, QB: 2, WR2: 3, RB2: 4, TE: 5, DST: 6 };
  remaining.sort((a, b) => {
    const ap = posPri[a.pos] ?? 6;
    const bp = posPri[b.pos] ?? 6;
    return ap !== bp ? ap - bp : TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team);
  });

  adpOrder.length = 0;
  adpOrder.push(...topOrder, ...remaining);

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
