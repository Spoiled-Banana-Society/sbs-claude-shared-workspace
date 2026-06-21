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
  KC: { QB: ['Patrick Mahomes', 'Justin Fields', 'Chris Oladokun'], RB1: ['Kenneth Walker', 'Emany Johnson', 'Emari Demercado'], RB2: ['Emany Johnson', 'Emari Demercado', 'Brashard Smith'], WR1: ['Rashee Rice', 'Xavier Worthy', 'Tyquan Thornton'], WR2: ['Xavier Worthy', 'Tyquan Thornton', 'Jalen Royals'], TE: ['Travis Kelce', 'Noah Gray', 'Jared Wiley'], DST: ['KC Defense'] },
  SF: { QB: ['Brock Purdy', 'Mac Jones', 'Kurtis Rourke'], RB1: ['Christian McCaffrey', 'Jordan James', 'Kaelon Black'], RB2: ['Jordan James', 'Kaelon Black', 'Isaac Guerendo'], WR1: ['Mike Evans', 'Ricky Pearsall', 'Christian Kirk'], WR2: ['Ricky Pearsall', 'Christian Kirk', 'De\'zhaun Stribling'], TE: ['George Kittle', 'Jake Tonges', 'Luke Farrell'], DST: ['SF Defense'] },
  MIA: { QB: ['Malik Willis', 'Quinn Ewers', 'Cam Miller'], RB1: ['De\'von Achane', 'Jaylen Wright', 'Ollie Gordon'], RB2: ['Jaylen Wright', 'Ollie Gordon', 'Donovan Edwards'], WR1: ['Malik Washington', 'Jalen Tolbert', 'Tutu Atwell'], WR2: ['Jalen Tolbert', 'Tutu Atwell', 'Caleb Douglas'], TE: ['Greg Dulcich', 'Will Kacmarek', 'Ben Sims'], DST: ['MIA Defense'] },
  DAL: { QB: ['Dak Prescott', 'Joe Milton', 'Sam Howell'], RB1: ['Javonte Williams', 'Malik Davis', 'Jaydon Blue'], RB2: ['Malik Davis', 'Jaydon Blue', 'Phil Mafah'], WR1: ['CeeDee Lamb', 'George Pickens', 'Ryan Flournoy'], WR2: ['George Pickens', 'Ryan Flournoy', 'KaVontae Turpin'], TE: ['Jake Ferguson', 'Luke Schoonmaker', 'Brevyn Spann-ford'], DST: ['DAL Defense'] },
  PHI: { QB: ['Jalen Hurts', 'Andy Dalton', 'Tanner Mckee'], RB1: ['Saquon Barkley', 'Tank Bigsby', 'Will Shipley'], RB2: ['Tank Bigsby', 'Will Shipley', 'Dameon Pierce'], WR1: ['DeVonta Smith', 'Makai Lemon', 'Dontayvion Wicks'], WR2: ['Makai Lemon', 'Dontayvion Wicks', 'Hollywood Brown'], TE: ['Dallas Goedert', 'Eli Stowers', 'Grant Calcaterra'], DST: ['PHI Defense'] },
  BUF: { QB: ['Josh Allen', 'Kyle Allen', 'Shane Buechele'], RB1: ['James Cook', 'Ty Johnson', 'Ray Davis'], RB2: ['Ty Johnson', 'Ray Davis', 'Frank Gore'], WR1: ['DJ Moore', 'Khalil Shakir', 'Joshua Palmer'], WR2: ['Khalil Shakir', 'Joshua Palmer', 'Keon Coleman'], TE: ['Dalton Kincaid', 'Dawson Knox', 'Jackson Hawes'], DST: ['BUF Defense'] },
  CIN: { QB: ['Joe Burrow', 'Joe Flacco', 'Josh Johnson'], RB1: ['Chase Brown', 'Samaje Perine', 'Tahj Brooks'], RB2: ['Samaje Perine', 'Tahj Brooks', 'Gary Brightwell'], WR1: ['Ja\'Marr Chase', 'Tee Higgins', 'Andrei Iosivas'], WR2: ['Tee Higgins', 'Andrei Iosivas', 'Craig Young'], TE: ['Mike Gesicki', 'Drew Sample', 'Erick All Jr.'], DST: ['CIN Defense'] },
  DET: { QB: ['Jared Goff', 'Teddy Bridgewater'], RB1: ['Jahmyr Gibbs', 'Isiah Pacheco', 'Sione Vaki'], RB2: ['Isiah Pacheco', 'Sione Vaki', 'Jacob Saylors'], WR1: ['Amon-Ra St. Brown', 'Jameson Williams', 'Isaac Teslaa'], WR2: ['Jameson Williams', 'Isaac Teslaa', 'Greg Dortch'], TE: ['Sam Laporta', 'Brock Wright', 'Tyler Conklin'], DST: ['DET Defense'] },
  BAL: { QB: ['Lamar Jackson', 'Tyler Huntley', 'Diego Pavia'], RB1: ['Derrick Henry', 'Justice Hill', 'Rasheen Ali'], RB2: ['Justice Hill', 'Rasheen Ali'], WR1: ['Zay Flowers', 'Rashod Bateman', 'Devontez Walker'], WR2: ['Rashod Bateman', 'Devontez Walker', 'Ja\'kobi Lane'], TE: ['Mark Andrews', 'Durham Smythe'], DST: ['BAL Defense'] },
  JAX: { QB: ['Trevor Lawrence', 'Nick Mullens', 'Carter Bradley'], RB1: ['Bhayshul Tuten', 'Chris Rodriguez Jr.', 'Lequint Allen JR'], RB2: ['Chris Rodriguez Jr.', 'Lequint Allen JR', 'Ameer Abdullah'], WR1: ['Brian Thomas Jr.', 'Jakobi Meyers', 'Parker Washington'], WR2: ['Jakobi Meyers', 'Parker Washington', 'Travis Hunter'], TE: ['Brenton Strange', 'Nate Boerkircher', 'Quintin Morris'], DST: ['JAX Defense'] },
  LAC: { QB: ['Justin Herbert', 'Trey Lance', 'Dj Uiagalelei'], RB1: ['Omarion Hampton', 'Keaton Mitchell', 'Kimani Vidal'], RB2: ['Keaton Mitchell', 'Kimani Vidal', 'Jaret Patterson'], WR1: ['Ladd Mcconkey', 'Quentin Johnston', 'Tre Harris'], WR2: ['Quentin Johnston', 'Tre Harris', 'Bryan Thompson'], TE: ['Oronde Gadsden', 'David Njoku', 'Charlie Kolar'], DST: ['LAC Defense'] },
  SEA: { QB: ['Sam Darnold', 'Drew Lock', 'Jalen Milroe'], RB1: ['Zach Charbonnet', 'Jadarian Price', 'George Holani'], RB2: ['Jadarian Price', 'George Holani', 'Emanuel Wilson'], WR1: ['Jaxon Smith-njigba', 'Cooper Kupp', 'Rashid Shaheed'], WR2: ['Cooper Kupp', 'Rashid Shaheed', 'Tory Horton'], TE: ['Aj Barner', 'Elijah Arroyo', 'Eric Saubert'], DST: ['SEA Defense'] },
  GB: { QB: ['Jordan Love', 'Tyrod Taylor', 'Kyle Mccord'], RB1: ['Josh Jacobs', 'Chris Brooks', 'Marshawn Lloyd'], RB2: ['Chris Brooks', 'Marshawn Lloyd', 'Pierre Strong Jr.'], WR1: ['Christian Watson', 'Jayden Reed', 'Matthew Golden'], WR2: ['Jayden Reed', 'Matthew Golden', 'Savion Williams'], TE: ['Tucker Kraft', 'Luke Musgrave', 'Josh Whyle'], DST: ['GB Defense'] },
  NYJ: { QB: ['Geno Smith', 'Brady Cook', 'Bailey Zappe'], RB1: ['Breece Hall', 'Braelon Allen', 'Isaiah Davis'], RB2: ['Braelon Allen', 'Isaiah Davis', 'Kene Nwangwu'], WR1: ['Garrett Wilson', 'Adonai Mitchell', 'Omar Cooper JR'], WR2: ['Adonai Mitchell', 'Omar Cooper JR', 'Tim Patrick'], TE: ['Kenyon Sadiq', 'Mason Taylor', 'Jeremy Ruckert'], DST: ['NYJ Defense'] },
  MIN: { QB: ['Kyler Murray', 'J.j. Mccarthy', 'Carson Wentz'], RB1: ['Aaron Jones', 'Jordan Mason', 'Zavier Scott'], RB2: ['Jordan Mason', 'Zavier Scott'], WR1: ['Justin Jefferson', 'Jordan Addison', 'Jauan Jennings'], WR2: ['Jordan Addison', 'Jauan Jennings', 'Tai Felton'], TE: ['T.J. Hockenson', 'Josh Oliver', 'Ben Yurosek'], DST: ['MIN Defense'] },
  ATL: { QB: ['Michael Penix Jr.', 'Tua Tagovailoa', 'Trevor Siemian'], RB1: ['Bijan Robinson', 'Brian Robinson JR', 'Tyler Goodson'], RB2: ['Brian Robinson JR', 'Tyler Goodson', 'Nathan Carter'], WR1: ['Drake London', 'Jahan Dotson', 'Olamide Zaccheaus'], WR2: ['Jahan Dotson', 'Olamide Zaccheaus', 'Zachariah Branch'], TE: ['Kyle Pitts', 'Austin Hooper', 'Charlie Woerner'], DST: ['ATL Defense'] },
  CLE: { QB: ['Deshaun Watson', 'Shedeur Sanders', 'Dillon Gabriel'], RB1: ['Quinshon Judkins', 'Dylan Sampson', 'Raheim Sanders'], RB2: ['Dylan Sampson', 'Raheim Sanders', 'Ahmani Marshall'], WR1: ['Jerry Jeudy', 'Kc Concepcion', 'Denzel Boston'], WR2: ['Kc Concepcion', 'Denzel Boston', 'Cedric Tillman'], TE: ['Harold Fannin Jr.', 'Jack Stoll', 'Blake Whiteheart'], DST: ['CLE Defense'] },
  HOU: { QB: ['C.j. Stroud', 'Davis Mills', 'Graham Mertz'], RB1: ['David Montgomery', 'Woody Marks', 'Jawhar Jordan'], RB2: ['Woody Marks', 'Jawhar Jordan', 'British Brooks'], WR1: ['Nico Collins', 'Jayden Higgins', 'Tank Dell'], WR2: ['Jayden Higgins', 'Tank Dell', 'Xavier Hutchinson'], TE: ['Dalton Schultz', 'Foster Moreau', 'Marlin Klein'], DST: ['HOU Defense'] },
  LV: { QB: ['Kirk Cousins', 'Fernando Mendoza', 'Aidan O\'connell'], RB1: ['Ashton Jeanty', 'Dylan Laube', 'Chris Collier'], RB2: ['Dylan Laube', 'Chris Collier'], WR1: ['Tre Tucker', 'Jalen Nailor', 'Jack Bech'], WR2: ['Jalen Nailor', 'Jack Bech', 'Dont\'e Thornton Jr.'], TE: ['Brock Bowers', 'Michael Mayer', 'Ian Thomas'], DST: ['LV Defense'] },
  TB: { QB: ['Baker Mayfield', 'Jake Browning', 'Connor Bazelak'], RB1: ['Bucky Irving', 'Kenneth Gainwell', 'Sean Tucker'], RB2: ['Kenneth Gainwell', 'Sean Tucker', 'Josh Williams'], WR1: ['Chris Godwin', 'Emeka Egbuka', 'Kameron Johnson'], WR2: ['Emeka Egbuka', 'Kameron Johnson', 'Ted Hurst'], TE: ['Cade Otton', 'Payne Durham', 'Ko Kieft'], DST: ['TB Defense'] },
  CHI: { QB: ['Caleb Williams', 'Tyson Bagent', 'Case Keenum'], RB1: ['D\'Andre Swift', 'Kyle Monangai', 'Roschon Johnson'], RB2: ['Kyle Monangai', 'Roschon Johnson', 'Brittain Brown'], WR1: ['Rome Odunze', 'Luther Burden', 'Kalif Raymond'], WR2: ['Luther Burden', 'Kalif Raymond', 'Zavion Thomas'], TE: ['Colston Loveland', 'Cole Kmet', 'Sam Roush'], DST: ['CHI Defense'] },
  PIT: { QB: ['Aaron Rodgers', 'Mason Rudolph', 'Will Howard'], RB1: ['Jaylen Warren', 'Rico Dowdle', 'Kaleb Johnson'], RB2: ['Rico Dowdle', 'Kaleb Johnson'], WR1: ['D.K. Metcalf', 'Michael Pittman JR', 'Germie Bernard'], WR2: ['Michael Pittman JR', 'Germie Bernard', 'Roman Wilson'], TE: ['Pat Freiermuth', 'Darnell Washington', 'Robert Tonyan'], DST: ['PIT Defense'] },
  DEN: { QB: ['Bo Nix', 'Jarrett Stidham', 'Sam Ehlinger'], RB1: ['J.K. Dobbins', 'Rj Harvey', 'Jaleel Mclaughlin'], RB2: ['Rj Harvey', 'Jaleel Mclaughlin'], WR1: ['Courtland Sutton', 'Jaylen Waddle', 'Troy Franklin'], WR2: ['Jaylen Waddle', 'Troy Franklin', 'Pat Bryant'], TE: ['Evan Engram', 'Adam Trautman', 'Nate Adkins'], DST: ['DEN Defense'] },
  LAR: { QB: ['Matthew Stafford', 'Ty Simpson', 'Stetson Bennett'], RB1: ['Kyren Williams', 'Blake Corum', 'Ronnie Rivers'], RB2: ['Blake Corum', 'Ronnie Rivers', 'Jarquez Hunter'], WR1: ['Puka Nacua', 'Davante Adams', 'Jordan Whittington'], WR2: ['Davante Adams', 'Jordan Whittington', 'Konata Mumpfield'], TE: ['Colby Parkinson', 'Tyler Higbee', 'Terrance Ferguson'], DST: ['LAR Defense'] },
  NO: { QB: ['Tyler Shough', 'Spencer Rattler', 'Zach Wilson'], RB1: ['Travis Etienne Jr.', 'Alvin Kamara', 'Devin Neal'], RB2: ['Alvin Kamara', 'Devin Neal', 'Kendre Miller'], WR1: ['Chris Olave', 'Jordyn Tyson', 'Devaughn Vele'], WR2: ['Jordyn Tyson', 'Devaughn Vele', 'Mason Tipton'], TE: ['Juwan Johnson', 'Noah Fant', 'Oscar Delp'], DST: ['NO Defense'] },
  TEN: { QB: ['Cam Ward', 'Mitchell Trubisky', 'Will Levis'], RB1: ['Tony Pollard', 'Tyjae Spears', 'Michael Carter'], RB2: ['Tyjae Spears', 'Michael Carter'], WR1: ['Carnell Tate', 'Wan\'Dale Robinson', 'Calvin Ridley'], WR2: ['Wan\'Dale Robinson', 'Calvin Ridley', 'Elic Ayomanor'], TE: ['Gunnar Helm', 'Daniel Bellinger', 'Kylen Granson'], DST: ['TEN Defense'] },
  IND: { QB: ['Daniel Jones', 'Anthony Richardson', 'Riley Leonard'], RB1: ['Jonathan Taylor', 'Dj Giddens', 'Ulysses Bentley'], RB2: ['Dj Giddens', 'Ulysses Bentley'], WR1: ['Alec Pierce', 'Josh Downs', 'Ashton Dulin'], WR2: ['Josh Downs', 'Ashton Dulin', 'Nick Westbrook-ikhine'], TE: ['Tyler Warren', 'Mo Alie-Cox', 'Drew Ogletree'], DST: ['IND Defense'] },
  ARI: { QB: ['Jacoby Brissett', 'Gardner Minshew', 'Carson Beck'], RB1: ['Jeremiyah Love', 'Tyler Allgeier', 'James Conner'], RB2: ['Tyler Allgeier', 'James Conner', 'Trey Benson'], WR1: ['Marvin Harrison Jr.', 'Michael Wilson', 'Kendrick Bourne'], WR2: ['Michael Wilson', 'Kendrick Bourne', 'Xavier Weaver'], TE: ['Trey McBride', 'Tip Reiman', 'Elijah Higgins'], DST: ['ARI Defense'] },
  WAS: { QB: ['Jayden Daniels', 'Marcus Mariota', 'Sam Hartman'], RB1: ['Jacory Croskey-merritt', 'Rachaad White', 'Kazmeir Allen'], RB2: ['Rachaad White', 'Kazmeir Allen', 'Jerome Ford'], WR1: ['Terry McLaurin', 'Luke Mccaffrey', 'Antonio Williams'], WR2: ['Luke Mccaffrey', 'Antonio Williams', 'Treylon Burks'], TE: ['Chig Okonkwo', 'John Bates', 'Ben Sinnott'], DST: ['WAS Defense'] },
  NYG: { QB: ['Jaxson Dart', 'Jameis Winston', 'Brandon Allen'], RB1: ['Cam Skattebo', 'Tyrone Tracy Jr.', 'Devin Singletary'], RB2: ['Tyrone Tracy Jr.', 'Devin Singletary', 'Eric Gray'], WR1: ['Malik Nabers', 'Darius Slayton', 'Darnell Mooney'], WR2: ['Darius Slayton', 'Darnell Mooney', 'Calvin Austin'], TE: ['Isaiah Likely', 'Theo Johnson', 'Chris Manhertz'], DST: ['NYG Defense'] },
  CAR: { QB: ['Bryce Young', 'Kenny Pickett', 'Will Grier'], RB1: ['Chuba Hubbard', 'Jonathon Brooks', 'Trevor Etienne'], RB2: ['Jonathon Brooks', 'Trevor Etienne', 'A.J. Dillon'], WR1: ['Tetairoa Mcmillan', 'Jalen Coker', 'Xavier Legette'], WR2: ['Jalen Coker', 'Xavier Legette', 'Chris Brazzell'], TE: ['Tommy Tremble', 'Ja\'tavion Sanders', 'Mitchell Evans'], DST: ['CAR Defense'] },
  NE: { QB: ['Drake Maye', 'Tommy Devito'], RB1: ['Rhamondre Stevenson', 'Treveyon Henderson', 'Terrell Jennings'], RB2: ['Treveyon Henderson', 'Terrell Jennings'], WR1: ['A.J. Brown', 'Romeo Doubs', 'Kayshon Boutte'], WR2: ['Romeo Doubs', 'Kayshon Boutte', 'Mack Hollins'], TE: ['Hunter Henry', 'Eli Raridon', 'Cj Dippre'], DST: ['NE Defense'] },
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
