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

// Live team-position ADP from playerStats2026 — the authoritative rankings the
// draft board + auto-pick use. Regenerated 2026-06-22 directly from Firestore so
// the roster panel + team cards show the SAME ADP as the live available-players
// list. Previously this was a stale HARDCODED order that had diverged from the
// live data (e.g. NE-WR1 showed 69 in the roster panel vs the real ADP 13).
// To refresh: re-read playerStats2026.playerMap.Players[*].ADP and paste here.
const LIVE_ADP: Record<string, number> = { "CIN-WR1": 1, "DET-RB1": 2, "LAR-WR1": 3, "ATL-RB1": 4, "DAL-WR1": 5, "SEA-WR1": 6, "DET-WR1": 7, "MIN-WR1": 8, "IND-RB1": 9, "SF-RB1": 10, "LV-RB1": 11, "BUF-RB1": 12, "NE-WR1": 13, "PHI-RB1": 14, "ATL-WR1": 15, "LAC-RB1": 16, "HOU-WR1": 17, "PHI-WR1": 18, "NO-WR1": 19, "MIA-RB1": 20, "KC-RB1": 21, "CIN-RB1": 22, "KC-WR1": 23, "BAL-RB1": 24, "LV-TE": 25, "LAC-WR1": 26, "CHI-WR1": 27, "ARI-RB1": 28, "TB-WR1": 29, "NYG-WR1": 30, "CAR-WR1": 31, "NYJ-RB1": 32, "BAL-WR1": 33, "NYJ-WR1": 34, "SF-WR1": 35, "DEN-WR1": 36, "LAR-RB1": 37, "NO-RB1": 38, "JAX-WR1": 39, "GB-WR1": 40, "ARI-TE": 41, "WAS-WR1": 42, "DAL-RB1": 43, "GB-RB1": 44, "NYG-RB1": 45, "TEN-WR1": 46, "BUF-WR1": 47, "NE-RB1": 48, "ARI-WR1": 49, "CHI-RB1": 50, "BUF-QB": 51, "HOU-RB1": 52, "TB-RB1": 53, "PIT-WR1": 54, "IND-WR1": 55, "JAX-RB1": 56, "CLE-RB1": 57, "SEA-RB1": 58, "CAR-RB1": 59, "PIT-RB1": 60, "TEN-RB1": 61, "DEN-RB1": 62, "CHI-TE": 63, "CLE-WR1": 64, "WAS-RB1": 65, "BAL-QB": 66, "MIN-RB1": 67, "LV-WR1": 68, "CIN-QB": 69, "WAS-QB": 70, "IND-TE": 71, "NE-QB": 72, "CHI-QB": 73, "PHI-QB": 74, "MIA-WR1": 75, "DAL-QB": 76, "DAL-WR2": 77, "LAC-QB": 78, "GB-TE": 79, "CIN-WR2": 80, "JAX-QB": 81, "KC-QB": 82, "NYG-QB": 83, "SF-QB": 84, "DET-TE": 85, "CLE-TE": 86, "LAR-QB": 87, "DEN-QB": 88, "LAR-WR2": 89, "DET-QB": 90, "HOU-DST": 91, "ATL-TE": 92, "MIN-QB": 93, "LAR-DST": 94, "GB-QB": 95, "DEN-DST": 96, "DET-WR2": 97, "SEA-DST": 98, "SF-TE": 99, "PHI-DST": 100, "TB-QB": 101, "NO-QB": 102, "MIN-DST": 103, "KC-TE": 104, "NE-DST": 105, "JAX-DST": 106, "DAL-TE": 107, "BAL-TE": 108, "PIT-DST": 109, "BUF-TE": 110, "MIA-QB": 111, "BAL-DST": 112, "DET-DST": 113, "NYG-TE": 114, "NE-RB2": 115, "DET-RB2": 116, "PHI-TE": 116, "BUF-DST": 117, "LAR-RB2": 118, "TEN-QB": 118, "LAC-DST": 119, "SEA-QB": 120, "HOU-QB": 121, "IND-QB": 122, "GB-DST": 123, "LAC-TE": 124, "WAS-TE": 125, "CHI-RB2": 126, "KC-DST": 126, "NE-TE": 127, "CLE-DST": 128, "PIT-RB2": 128, "JAX-TE": 129, "CAR-QB": 129, "SF-DST": 131, "NYJ-TE": 132, "NO-TE": 133, "MIN-WR2": 134, "IND-DST": 135, "NO-WR2": 136, "ATL-DST": 137, "CHI-WR2": 138, "MIN-TE": 139, "NO-DST": 140, "ATL-RB2": 140, "LV-QB": 141, "CAR-DST": 142, "HOU-TE": 143, "TB-RB2": 144, "PHI-WR2": 144, "NYG-DST": 145, "PIT-QB": 146, "SEA-TE": 147, "CHI-DST": 148, "TEN-TE": 149, "DEN-RB2": 150, "NYJ-QB": 150, "CAR-RB2": 153, "LAC-RB2": 155, "TB-DST": 160, "SEA-WR2": 161, "JAX-WR2": 162, "TB-TE": 163, "DAL-DST": 164, "MIA-TE": 165, "MIA-DST": 166, "LAC-WR2": 167, "PIT-TE": 168, "TEN-DST": 169, "JAX-RB2": 170, "DEN-WR2": 171, "NYG-RB2": 172, "ARI-QB": 173, "TB-WR2": 174, "WAS-DST": 175, "KC-WR2": 176, "GB-WR2": 177, "LAR-TE": 178, "CIN-DST": 179, "ATL-QB": 180, "CIN-TE": 181, "NE-WR2": 182, "NYJ-DST": 183, "WAS-RB2": 184, "LV-DST": 185, "ARI-RB2": 186, "MIN-RB2": 187, "HOU-WR2": 188, "PHI-RB2": 189, "ARI-DST": 190, "SF-WR2": 191, "HOU-RB2": 192, "ARI-WR2": 193, "IND-WR2": 194, "LV-RB2": 195, "SF-RB2": 196, "PIT-WR2": 197, "BUF-RB2": 198, "KC-RB2": 199, "CAR-WR2": 200, "TEN-WR2": 201, "SEA-RB2": 202, "NYJ-WR2": 203, "BUF-WR2": 204, "ATL-WR2": 205, "NO-RB2": 206, "TEN-RB2": 207, "CLE-RB2": 208, "IND-RB2": 209, "NYJ-RB2": 210, "WAS-WR2": 211, "NYG-WR2": 212, "DAL-RB2": 213, "GB-RB2": 214, "BAL-WR2": 215, "MIA-RB2": 216, "CIN-RB2": 217, "BAL-RB2": 218, "CLE-WR2": 219, "LV-WR2": 220, "MIA-WR2": 221, "DEN-TE": 222, "CLE-QB": 223, "CAR-TE": 224 };

// The server convention (playerStats2026/playerMap) gives RB2/WR2 the SAME full
// position pool as RB1/WR1 — the depth chart always starts at the star. The
// hardcoded arrays above were authored offset-by-one for the 2-slots, which hid
// every team's RB1/WR1 from the lobby depth chart. Merge base pool + slot extras
// so the lobby matches what the server shows once the draft starts.
function fullPositionPool(teamPlayers: Record<string, string[]>, pos: string): string[] | undefined {
  const basePos = pos === 'RB2' ? 'RB1' : pos === 'WR2' ? 'WR1' : pos;
  const base = teamPlayers[basePos];
  const own = teamPlayers[pos];
  if (!base && !own) return undefined;
  const merged = [...(base || [])];
  for (const name of own || []) {
    if (!merged.includes(name)) merged.push(name);
  }
  return merged;
}

function generateAllPositions(): PlayerData[] {
  const players: PlayerData[] = [];
  for (const team of TEAMS) {
    for (const pos of POSITIONS_PER_TEAM) {
      const playerId = `${team}-${pos}`;
      const teamPlayers = TEAM_PLAYERS[team];
      const posPlayers = (teamPlayers && fullPositionPool(teamPlayers, pos)) || [`${team} ${pos}`];
      const adp = LIVE_ADP[playerId] ?? 999;
      players.push({
        playerId,
        team,
        position: pos,
        adp,
        rank: adp,
        byeWeek: BYE_WEEKS[team] || 7,
        playersFromTeam: posPlayers,
      });
    }
  }
  // Keep the array best-first (by ADP) so any consumer that iterates it (e.g. the
  // filling phase, before live server data loads) shows the same order as the board.
  players.sort((a, b) => a.adp - b.adp);
  return players;
}

export const ALL_POSITIONS: PlayerData[] = generateAllPositions();
