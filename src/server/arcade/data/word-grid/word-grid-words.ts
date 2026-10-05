// ───────────────────────────────────────────────────────────────────────────
// Word Grid — word data (SERVER-ONLY).
//
// Import these ONLY from server route handlers / server modules. They must
// NEVER reach the client bundle: WORD_GRID_VALID is large (~11.7k words) and
// WORD_GRID_ANSWERS would leak the daily solution.
//
//   • WORD_GRID_ANSWERS — curated common, unambiguous 5-letter solution words.
//       The day's answer = WORD_GRID_ANSWERS[seed % WORD_GRID_ANSWERS.length].
//   • WORD_GRID_VALID    — superset used ONLY to validate a typed guess is a
//       real word. Contains every answer plus thousands more 5-letter words.
//
// All entries are exactly 5 lowercase a–z letters, deduped. Generated + checked
// (every answer ∈ valid; all length-5 lowercase; no duplicates).
// ───────────────────────────────────────────────────────────────────────────

/** Curated daily solution words (common, fair, unambiguous). */
export const WORD_GRID_ANSWERS: readonly string[] = [
  "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
  "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
  "along", "aloud", "alpha", "alter", "amber", "amend", "among", "ample", "angel", "anger",
  "angle", "angry", "ankle", "apart", "apple", "apply", "april", "arena", "argue", "arise",
  "armor", "aroma", "array", "arrow", "ashen", "aside", "asset", "audio", "audit", "avoid",
  "awake", "award", "aware", "awful", "bacon", "badge", "baker", "baron", "basic", "basin",
  "batch", "beach", "beard", "beast", "began", "begin", "being", "belly", "below", "bench",
  "berry", "birth", "black", "blade", "blame", "bland", "blank", "blast", "blaze", "bleak",
  "bleed", "blend", "bless", "blind", "blink", "bliss", "block", "blond", "blood", "bloom",
  "blown", "bluff", "blunt", "blush", "board", "boast", "bonus", "boost", "booth", "boots",
  "bound", "brace", "braid", "brain", "brake", "brand", "brass", "brave", "bread", "break",
  "breed", "brick", "bride", "brief", "bring", "brink", "brisk", "broad", "broke", "brook",
  "broom", "brown", "brush", "buddy", "build", "built", "bunch", "burnt", "burst", "cabin",
  "cable", "cache", "camel", "candy", "canoe", "cargo", "carol", "carry", "carve", "catch",
  "cause", "cease", "chain", "chair", "chalk", "champ", "chant", "chaos", "charm", "chart",
  "chase", "cheap", "check", "cheek", "cheer", "chess", "chest", "chief", "child", "chill",
  "chime", "china", "chirp", "choir", "chord", "chose", "chuck", "chunk", "churn", "cider",
  "cigar", "civic", "civil", "claim", "clamp", "clash", "clasp", "class", "clean", "clear",
  "clerk", "click", "cliff", "climb", "cling", "cloak", "clock", "close", "cloth", "cloud",
  "clown", "coach", "coast", "cobra", "cocoa", "coral", "couch", "cough", "could", "count",
  "court", "cover", "crack", "craft", "crane", "crash", "crate", "crawl", "crazy", "cream",
  "creek", "creep", "crept", "crest", "crime", "crisp", "cross", "crowd", "crown", "crude",
  "cruel", "crumb", "crush", "crust", "crypt", "curly", "curse", "curve", "cycle", "daddy",
  "daily", "dairy", "daisy", "dance", "dandy", "dated", "dealt", "death", "debut", "decay",
  "delay", "delta", "dense", "depth", "devil", "diary", "dimly", "diner", "dingo", "ditch",
  "diver", "dizzy", "dodge", "dough", "dozen", "draft", "drain", "drama", "drank", "drape",
  "drawn", "dread", "dream", "dress", "dried", "drift", "drill", "drink", "drive", "droll",
  "drone", "drool", "droop", "drove", "drown", "dryer", "eager", "eagle", "early", "earth",
  "easel", "eaten", "ebony", "edict", "eerie", "eight", "elbow", "elder", "elect", "elite",
  "ember", "empty", "enact", "ended", "enemy", "enjoy", "enter", "entry", "equal", "equip",
  "erase", "error", "erupt", "ethic", "event", "every", "exact", "exalt", "exams", "excel",
  "exert", "exile", "exist", "extra", "fable", "faced", "facet", "faint", "fairy", "faith",
  "false", "fancy", "fatal", "fault", "favor", "feast", "fence", "ferry", "fetch", "fever",
  "fewer", "fiber", "field", "fiery", "fifth", "fifty", "fight", "final", "finch", "fired",
  "first", "fishy", "fixed", "fizzy", "flair", "flame", "flank", "flare", "flash", "flask",
  "fleet", "flesh", "flick", "fling", "flint", "float", "flock", "flood", "floor", "flora",
  "flour", "flown", "fluid", "flung", "flush", "flute", "focus", "foggy", "force", "forge",
  "forte", "forth", "forty", "found", "frame", "frank", "fraud", "fresh", "fried", "frill",
  "frock", "frost", "frown", "froze", "fruit", "fully", "fumes", "funny", "furry", "gable",
  "gamer", "gauge", "gazed", "geese", "genie", "genre", "ghost", "giant", "given", "glade",
  "gland", "glare", "glass", "glaze", "gleam", "glide", "globe", "gloom", "glory", "gloss",
  "glove", "gourd", "grace", "grade", "grail", "grain", "grand", "grant", "grape", "graph",
  "grasp", "grass", "grave", "gravy", "graze", "great", "greed", "green", "greet", "grief",
  "grill", "grime", "grind", "groan", "groom", "grout", "grove", "growl", "grown", "gruel",
  "grunt", "guard", "guess", "guest", "guide", "guild", "guilt", "gully", "gumbo", "guppy",
  "habit", "hairy", "halve", "handy", "happy", "hardy", "harsh", "haste", "hatch", "haunt",
  "haven", "havoc", "hazel", "heart", "heath", "heavy", "hedge", "hefty", "heist", "hello",
  "hence", "herbs", "heron", "hilly", "hinge", "hippo", "hitch", "hoard", "hobby", "hoist",
  "holly", "homer", "honey", "honor", "horde", "horse", "hotel", "hound", "house", "hover",
  "human", "humid", "humor", "hunch", "hurry", "husky", "hutch", "hydro", "hyena", "ideal",
  "idiot", "igloo", "image", "inbox", "incur", "index", "inert", "infer", "inlet", "inner",
  "input", "intro", "irony", "issue", "ivory", "jaded", "jazzy", "jeans", "jelly", "jewel",
  "joint", "joker", "jolly", "judge", "juice", "juicy", "jumbo", "kayak", "kebab", "khaki",
  "kinky", "kiosk", "kitty", "knack", "knead", "kneel", "knelt", "knife", "knock", "known",
  "koala", "label", "labor", "laden", "ladle", "lance", "lapel", "large", "laser", "latch",
  "later", "laugh", "layer", "leafy", "leaky", "leant", "leapt", "learn", "lease", "least",
  "ledge", "lemon", "level", "lever", "light", "liken", "lilac", "limbo", "liner", "lingo",
  "lipid", "lithe", "liver", "llama", "loach", "lobby", "local", "lodge", "lofty", "logic",
  "loose", "lorry", "loser", "lotus", "lousy", "loved", "lover", "lower", "loyal", "lucid",
  "lucky", "lumen", "lunar", "lunch", "lunge", "lupus", "lurch", "lurid", "lusty", "lying",
  "lyric", "macaw", "macro", "madam", "major", "maker", "mango", "manor", "maple", "march",
  "marsh", "match", "mater", "maths", "mauve", "maxim", "mayor", "meant", "meaty", "medal",
  "media", "melon", "mercy", "merge", "merit", "merry", "messy", "metal", "meter", "midst",
  "might", "minor", "minus", "mirth", "miser", "mocha", "modal", "model", "modem", "moist",
  "molar", "money", "month", "moody", "moose", "moral", "motor", "motto", "mound", "mount",
  "mourn", "mouse", "mouth", "mover", "movie", "mower", "mucky", "muddy", "mulch", "mummy",
  "mural", "mused", "music", "musty", "myrrh", "nadir", "naive", "named", "nanny", "nasal",
  "nasty", "naval", "navel", "needy", "nerdy", "nerve", "never", "newer", "newly", "nicer",
  "niche", "niece", "night", "ninja", "ninth", "noble", "noise", "noisy", "nomad", "north",
  "nosey", "notch", "noted", "novel", "nudge", "nurse", "nutty", "nylon", "oaken", "oasis",
  "occur", "ocean", "often", "olive", "omega", "onion", "onset", "opera", "opium", "optic",
  "orbit", "organ", "ought", "ounce", "outdo", "outer", "ovary", "overt", "owned", "owner",
  "oxide", "ozone", "paced", "paddy", "paint", "paler", "palms", "panda", "panel", "panic",
  "paper", "party", "pasta", "paste", "patch", "patio", "pause", "peace", "peach", "pearl",
  "pecan", "pedal", "penal", "penny", "perch", "peril", "perky", "pesky", "petal", "petty",
  "phase", "phone", "photo", "piano", "picky", "piece", "piety", "piggy", "pilot", "pinch",
  "pinky", "pints", "pious", "piper", "pitch", "pivot", "pixel", "pixie", "pizza", "place",
  "plaid", "plain", "plait", "plane", "plank", "plant", "plate", "plaza", "plead", "pleat",
  "plumb", "plume", "plump", "plush", "poach", "point", "poise", "poker", "polar", "polio",
  "polka", "porch", "posed", "posse", "pouch", "pound", "power", "prank", "prawn", "press",
  "price", "prick", "pride", "prime", "print", "prior", "prism", "prize", "probe", "prone",
  "proof", "prose", "proud", "prove", "prowl", "proxy", "prune", "psalm", "pubic", "pudgy",
  "puffy", "pulpy", "pulse", "punch", "pupil", "puppy", "puree", "purge", "purse", "pygmy",
  "quack", "quail", "quake", "qualm", "quart", "queen", "query", "quest", "queue", "quick",
  "quiet", "quill", "quilt", "quirk", "quite", "quota", "quote", "rabbi", "rabid", "racer",
  "radar", "radio", "rainy", "raise", "rally", "ranch", "range", "rapid", "raspy", "ratio",
  "raven", "razor", "reach", "react", "ready", "realm", "rebel", "rebut", "reedy", "refer",
  "regal", "reign", "relax", "relay", "relic", "remit", "renal", "repay", "repel", "reply",
  "reset", "resin", "retry", "rhino", "rhyme", "rider", "ridge", "rifle", "right", "rigid",
  "rinse", "ripen", "riser", "risky", "rival", "river", "roast", "robin", "robot", "rocky",
  "rogue", "roman", "rotor", "rouge", "rough", "round", "rouse", "route", "rover", "royal",
  "ruddy", "ruger", "ruler", "rumor", "rural", "rusty", "sable", "salad", "salon", "salsa",
  "salty", "salve", "sandy", "satin", "sauce", "saucy", "sauna", "saved", "savor", "savoy",
  "scald", "scale", "scalp", "scant", "scare", "scarf", "scary", "scene", "scent", "scoff",
  "scold", "scone", "scoop", "scope", "score", "scorn", "scour", "scout", "scowl", "scrap",
  "scrub", "scuba", "sedan", "seedy", "seize", "sense", "serif", "serum", "serve", "seven",
  "sever", "sewer", "shack", "shade", "shady", "shaft", "shake", "shaky", "shale", "shall",
  "shame", "shape", "share", "shark", "sharp", "shave", "shawl", "sheaf", "shear", "sheen",
  "sheep", "sheer", "sheet", "shelf", "shell", "shied", "shift", "shine", "shiny", "shire",
  "shirk", "shirt", "shoal", "shock", "shone", "shook", "shoot", "shore", "shorn", "short",
  "shout", "shove", "shown", "showy", "shrub", "shrug", "shuck", "shush", "shyly", "siege",
  "sigma", "silky", "silly", "since", "sinew", "siren", "sixth", "sixty", "sized", "skate",
  "skier", "skill", "skimp", "skirt", "skull", "skunk", "slack", "slain", "slang", "slant",
  "slash", "slate", "slave", "sleek", "sleep", "sleet", "slept", "slice", "slick", "slide",
  "slime", "slimy", "sling", "slink", "slope", "slosh", "sloth", "slump", "slung", "slush",
  "smack", "small", "smart", "smash", "smear", "smell", "smelt", "smile", "smirk", "smith",
  "smock", "smoke", "smoky", "snack", "snail", "snake", "snaky", "snare", "snarl", "sneak",
  "sneer", "snide", "sniff", "snipe", "snoop", "snore", "snort", "snout", "snowy", "snuck",
  "sober", "solar", "solid", "solve", "sonar", "sonic", "sooty", "sorry", "sound", "south",
  "space", "spade", "spank", "spare", "spark", "spasm", "spawn", "speak", "spear", "speck",
  "speed", "spell", "spend", "spent", "sperm", "spice", "spicy", "spike", "spill", "spilt",
  "spine", "spiny", "spire", "spite", "splat", "split", "spoil", "spoke", "spool", "spoon",
  "spore", "sport", "spout", "spray", "spree", "sprig", "spurn", "spurt", "squad", "squat",
  "squid", "stack", "staff", "stage", "staid", "stain", "stair", "stake", "stale", "stalk",
  "stall", "stamp", "stand", "stank", "stare", "stark", "start", "stash", "state", "stave",
  "stead", "steak", "steal", "steam", "steed", "steel", "steep", "steer", "stein", "stern",
  "stick", "stiff", "still", "stilt", "sting", "stink", "stint", "stock", "stoic", "stole",
  "stomp", "stone", "stood", "stool", "stoop", "store", "stork", "storm", "story", "stout",
  "stove", "strap", "straw", "stray", "strip", "strut", "stuck", "study", "stuff", "stump",
  "stung", "stunt", "suave", "sugar", "suite", "sulky", "sully", "sunny", "super", "surge",
  "surly", "swamp", "swarm", "swash", "swath", "swear", "sweat", "sweep", "sweet", "swell",
  "swept", "swift", "swine", "swing", "swirl", "swish", "swoon", "swoop", "sword", "swore",
  "sworn", "syrup", "table", "taboo", "tacit", "tacky", "taffy", "taint", "taken", "taker",
  "tally", "talon", "tango", "taper", "tapir", "tardy", "tarot", "taste", "tasty", "taunt",
  "taupe", "tawny", "teach", "tease", "teddy", "teeth", "tempo", "tenor", "tense", "tenth",
  "tepee", "tepid", "terra", "terse", "testy", "thank", "theft", "their", "theme", "there",
  "these", "thick", "thief", "thigh", "thing", "think", "third", "thong", "thorn", "those",
  "three", "threw", "throb", "throw", "thrum", "thumb", "thump", "thyme", "tiara", "tibia",
  "tidal", "tiger", "tight", "tilde", "timer", "timid", "tipsy", "titan", "tithe", "title",
  "toast", "today", "toddy", "token", "tonal", "tonga", "tonic", "tooth", "topaz", "topic",
  "torch", "torso", "total", "totem", "touch", "tough", "towel", "tower", "toxic", "toxin",
  "trace", "track", "tract", "trade", "trail", "train", "trait", "tramp", "trash", "tread",
  "treat", "trend", "triad", "trial", "tribe", "trick", "tried", "tripe", "trite", "troll",
  "troop", "trope", "trout", "truce", "truck", "truly", "trump", "trunk", "trust", "truth",
  "tulip", "tumor", "tunic", "turbo", "tutor", "twang", "tweak", "tweed", "tweet", "twice",
  "twine", "twirl", "twist", "tying", "udder", "ulcer", "ultra", "umber", "uncle", "under",
  "undid", "undue", "unfit", "unify", "union", "unite", "unity", "unlit", "unmet", "unset",
  "until", "unzip", "upper", "upset", "urban", "usage", "usher", "using", "usual", "utter",
  "vague", "valet", "valid", "valor", "value", "valve", "vapor", "vault", "vegan", "venom",
  "venue", "verge", "verse", "vexed", "vicar", "video", "vigil", "villa", "vinyl", "viola",
  "viper", "viral", "virus", "visit", "visor", "vista", "vital", "vivid", "vixen", "vocal",
  "vodka", "vogue", "voice", "voila", "vomit", "voter", "vouch", "vowel", "wacky", "wafer",
  "wager", "wagon", "waist", "waive", "waltz", "waned", "wares", "warty", "waste", "watch",
  "water", "waver", "waxen", "weary", "weave", "wedge", "weedy", "weigh", "weird", "welch",
  "wench", "whack", "whale", "wharf", "wheat", "wheel", "whelp", "where", "which", "whiff",
  "while", "whine", "whiny", "whirl", "whisk", "white", "whole", "whoop", "whose", "widen",
  "wider", "widow", "width", "wield", "wight", "wimpy", "wince", "winch", "windy", "wiped",
  "wired", "wiser", "witch", "witty", "woken", "woman", "women", "woody", "wooed", "wooer",
  "world", "worry", "worse", "worst", "worth", "would", "wound", "woven", "wrack", "wrath",
  "wreak", "wreck", "wrest", "wring", "wrist", "write", "wrong", "wrote", "wrung", "wryly",
  "yacht", "yearn", "yeast", "yield", "yodel", "yokel", "young", "youth", "yummy", "zebra",
  "zesty", "zonal",
];

// The allowed-guess dictionary is stored as wrapped, space-joined chunks and
// expanded into a Set at module load for O(1) membership checks. Each chunk
// keeps a trailing space so concatenation preserves word boundaries. Storing it
// as packed strings (vs an ~11.7k-element array literal) keeps this file
// readable and the parsed payload small.
const WORD_GRID_VALID_PACKED =
  "aback abaft abase abash abate abbey abbot abeam abets abhor abide abled abode abort about above abuse abuts " +
  "abuzz abyss ached aches acids acing acmes acorn acred acres acrid acted actor acute addax added adder addle " +
  "adieu adios adits adman admen admit admix adobe adopt adore adorn adult adust aegis aeons aerie affix afire " +
  "afoot afoul afros after again agape agars agate agave agaze agent agers aglow agone agora agree ahead aided " +
  "aider aides ailed aimed aimer aired airns aisle aitch alack alarm alate albas album alcid alder alecs aleph " +
  "alert alfas algae algal algas alias alibi alien align alike aline alive alkyd allay alley allot allow alloy " +
  "almas almeh aloes aloft aloha alone along aloof aloud alpha altar alter altho altos alums amahs amass amaze " +
  "amber ambit amble ambos ameba amend amens ament amias amice amici amide amids amies amigo amine amino amins " +
  "amirs amiss amity ammos amnia amnio among amort amour amped ample amply ampul amuck amuse amyls anele angas " +
  "angel anger angle anglo angry angst anile anils anima anime animi anion anise anker ankhs ankle annas annex " +
  "annoy annul anode anole antas anted antes antic antis antra antre anvil aorta apace apart apeak apers apery " +
  "aphid aphis apian aping apnea apods aport appal apple apply april apron apses apsis apter aptly aquae arabs " +
  "araks arbor arced areae areal areas areca arena arepa argal argil argle argol argon argot argue argus arhat " +
  "arias ariel arils arise armed armer armet armor aroid aroma arose arpen arras array arris arrow arroz arsis " +
  "arson artal artel artsy aruba arums asana ascot ashed ashen ashes aside asked asker askew aspen asper aspic " +
  "assai assay asset aster astir asyla atilt atlas atman atoll atoms atomy atone atony attar attic audio audit " +
  "auger aught augur aunts aural auras auric autos auxin avail avant avast avers avert avgas avian avion avoid " +
  "await awake award aware awash awful awing awned axels axial axile axils axing axiom axion axite axled axles " +
  "axman axmen axone axons azans azide azido azine azole azons azote azoth azure babas babes babka baboo babul " +
  "babus bacca backs bacon badge badly baffs bagel baggy baits baize baked baker bakes balas balds baldy baled " +
  "baler bales balks balky balls bally balms balmy balsa banal banco bands bandy baned banes bangs banjo banks " +
  "barbe barbs barde bards bared barer bares barfs barge baric barks barky barms barmy barns barny baron barre " +
  "basal based baser bases basic basil basin basis basks bassi basso baste basts batch bated bates bathe baths " +
  "batik baton batts batty bauds baulk bawds bawdy bawls bayed bayou bazar beach beads beady beaks beaky beams " +
  "beano beans beard bears beast beats beaus beaut beaux bebop becap becks bedel bedew bedim beech beedi beefs " +
  "beefy beeps beers beery beets befit befog began begat beget begin begot begum begun beige being belay belch " +
  "belie belle bells belly below belts bemas bench bends bendy benes benne benni bento bents beret bergs berms " +
  "berry berth beryl beset besom besot bests betas betel beths betta bevel bezel bhang bhoot bhuts bialy bibbs " +
  "bible bices biddy bided bider bides bidet bield biers biffs biffy bifid biggy bight bigly bigot bijou biked " +
  "biker bikes bikie bilbo biles bilge bilgy bilks bills billy bimah bimas bimbo binal bindi binds bines binge " +
  "bingo binit binks biome biont biota biped bipod birch birds birks birle birls biros birrs birse birth bises " +
  "bisks bison bitch biter bites bitsy bitts bitty bivia bizes black blade blads blahs blain blame blams bland " +
  "blank blare blase blast blate blats blaze bleak blear bleat blebs bleed blend blent bless blest blets blimp " +
  "blind bling blini blink blips bliss blite blitz bloat blobs block blocs bloke blond blood bloom bloop blots " +
  "blown blows blowy blued bluer blues bluet bluey bluff blume blunt blurb blurs blurt blush blype board boars " +
  "boart boast boats bobby bocce bocci boche bocks boded bodes boffo boffs bogan bogey boggy bogie bogle bogus " +
  "bohea boils boing boink bolar bolas bolds boles bolls bolos bolts bolus bombe bombs bonce bonds boned boner " +
  "bones boney bongo bongs bonks bonne bonny bonus bonze booby booed books booms boomy boons boors boost booth " +
  "boots booty booze boozy borak boral boras borax bored borer bores borne boron borts borty bortz bosks bosky " +
  "bosom boson bossy bosun botas botch botel bothy botts bough bound bourg bourn bouse bousy bouts bovid bowed " +
  "bowel bower bowls bowse boxed boxer boxes boyar boyos bozos brace brach bract braes brags braid brail brain " +
  "brake braky brand brank brans brant brash brass brats brave bravo brawl brawn braws braxy brays braze bread " +
  "break bream breds breed brees brens brent brere breve brevi brews briar bribe brick bride brief brier bries " +
  "brigs brill brims brine bring brink briny brios brisk brits britt broad broch brock broil broke brome bronc " +
  "brood brook brool broom broos broth brown brows bruin bruit brule brume brunt brush brusk brute bubal bubba " +
  "bubby bucks buddy budge budos buffa buffe buffi buffo buffs buffy buggy bugle buhls buhrs build built bulbs " +
  "bulge bulgy bulks bulky bulla bulls bully bumph bumps bumpy bunas bunch bunco bunds bundt bundu bungs bunko " +
  "bunks bunny bunts bunya buoys buppy buran buras burbs burds buret burgh burgs burin burka burke burls burly " +
  "burns burnt burps burqa burro burrs burry bursa burse burst busby bused buses bushy busks busts busty butch " +
  "buteo butes butle butte butts butty butut butyl buxom buyer buzzy bwana bylaw byres byrls byssi bytes byway " +
  "cabal cabby caber cabin cable cabob cacao cacas cache cacti caddy cades cadet cadge cadgy cadis cadre caeca " +
  "cafes caffs caged cager cages cagey cahow caids cains cairn cajon caked cakes cakey calfs calif calix calks " +
  "calla calls calms calmy calos calve calyx camas camel cameo campi campo camps campy canal candy caned caner " +
  "canes canid canna canns canny canoe canon canso canst canto cants canty caped caper capes capiz capon capos " +
  "capot capri carat carbo carbs cards cared carer cares caret carex cargo carls carns carny carob carol carom " +
  "carpe carpi carps carrs carry carse carte carts carve casas cased cases casks casky caste casts catch cater " +
  "cates cause caved caver caves cavie cavil cawed cease cebid cecal cecum cedar ceded ceder cedes ceiba ceili " +
  "ceils celeb cella cells celom centi cento cents ceorl cered ceres ceria cesta cesti cetes chads chafe chaff " +
  "chain chair chais chalk champ chams chana chant chaos chape chaps chapt chara chard chare chark charm charr " +
  "chars chart chary chase chasm chats chaws chaya chays cheap cheat check cheek cheep cheer chefs chela chert " +
  "chess chest cheth chevy chews chewy chiao chias chick chico chics chide chief chiel chigs child chile chili " +
  "chill chimb chime chimp china chine ching chink chino chins chips chirk chirm chiro chirp chirr chits chive " +
  "chivy chock choco chode choir choke choky chola chold chomp chook choon chops chord chore chose chott chows " +
  "chubs chuck chufa chugs chump chums chunk churl churn churr chute chyle chyme cibol cider cigar ciggy cilia " +
  "cills cimex cinch cines cions circa cires cirls cirri cisco cissy cists cited citer cites civet civic civie " +
  "civil clach clack clade clads claes clags claim clamp clams clang clank clans claps clapt claro clary clash " +
  "clasp class clast clave claws clays clean clear cleat cleck clefs cleft clegs clepe clept clerk clews click " +
  "clied clies cliff clift climb clime cline cling clink clint clips clipt cloak clock clods clogs clomb clomp " +
  "clone clonk clons cloop cloot clops close clote cloth clots cloud clour clous clout clove clown cloye cloys " +
  "cloze clubs cluck clued clues clump clung clunk cnida coach coact coala coals coaly coapt coast coate coati " +
  "coats cobbs cobby coble cobra cobza cocas cocci cocks cocky cocoa cocos codas codec coded coden coder codes " +
  "codex codon coeds coffs cofts cogie cogon cohab cohog coifs coign coils coins coirs coits coked cokes colas " +
  "colby colds coled coles colic colin colla colls colly colog colon color colts colza comae comal comas combe " +
  "combo combs comer comes comet comfy comix comma commo comms compo comps comte conch condo coned cones coney " +
  "congo conia conic conin conks conky conne conns conte conto cooed cooee cooer coofs cooks cooky cools cooly " +
  "coomb coons coops coopt coost coots copal copay coped copen coper copes copra copse copsy coral coram corbe " +
  "cords cored corer cores corey corgi coria corks corky corms corni corno corns cornu corny corps corse corso " +
  "cosec coses coset cosey cosie costa coste costs cotan coted cotes cotts couch cough could count coupe coups " +
  "courb coure cours court couta coved coven cover coves covet covey covin cowal cowan cowed cower cowks cowls " +
  "cowps cowry coxae coxal coxed coxes coyau coyed coyer coyly coypu cozed cozen cozes cozey cozie crabs crack " +
  "craft crags craic craik crake cramp crams crane crank crape craps crapy crare crash crass crate crave crawl " +
  "craws crays craze crazy creak cream credo creds creed creek creel creep crees creme crems crena crepe crept " +
  "crepy cress crest crewe crews cribs crick cried crier cries crime crimp crims crine crios crips crisp crith " +
  "crits croak croci crock crocs croft crogs cromb crome crone cronk crons crony crook crool croon crops crore " +
  "cross crost croup crout crowd crown crows croze cruck crude cruds cruel crues cruet crumb crump crunk cruor " +
  "crura cruse crush crust cruve crwth cryos crypt cuban cubby cubed cuber cubes cubic cubit cuddy cuffo cuffs " +
  "cuifs cuing cuish cuits cukes culch culet culex culls cully culms culpa culti cults cumin cundy cunei cunts " +
  "cupel cupid cuppa cuppy curat curbs curch curds curdy cured curer cures curet curfs curia curie curio curli " +
  "curls curly curns curny currs curry curse curst curve curvy cusec cushy cusks cusps cuspy cusso cutch cuter " +
  "cutes cutey cutie cutin cutis cutto cutty cutup cuvee cuzes cwtch cyans cyber cycad cycas cycle cyclo cyder " +
  "cylix cymae cymar cymas cymes cymol cynic cysts cytes cyton czars dacha daddy dados daffs daggy dagos dahls " +
  "daiko daily daine daint dairy daisy daker dales dalis dally daman damar dames damns damps dance dancy dandy " +
  "dangs danio darbs darcy dared darer dares daric darks darky darns darts dashi dashy dated dater dates datos " +
  "datto datum daube daubs dauby dault daunt daurs dauts daven davit dawah dawds dawed dawen dawks dawns dawts " +
  "dazed dazer dazes deads deair deals dealt deans deare dearn dears deary deash death deave deaws deawy debag " +
  "debar debby debel debes debit debts debud debug debur debus debut debye decad decaf decal decan decay decko " +
  "decks decor decoy decry dedal deeds deedy deejs deely deems deens deeps deere deers deets defat defer defis " +
  "defog degas degum degus deice deids deify deign deils deism deist deity deked dekes dekko delay deled deles " +
  "delfs delft delis dells delly delos delph delta delts delve deman demes demic demit demob demon demos dempt " +
  "demur denar denay dench denes denet denim denis dense dents deoxy depot depth derat deray derby deres derig " +
  "derma derms derns derny derro derry derth dervs desex deshi desks desse deter detox deuce devas devel devil " +
  "devis devon devos devot dewan dewar dewax dewed dexes dexie dhaba dhaks dhals dhikr dhobi dhole dholl dhols " +
  "dhoti dhows dhuti dials diary diazo dibbs dicar diced dicer dices dicey dicht dicks dicky dicot dicta dicts " +
  "diddy didie didos didst diebs diene diets diffs dight digit dikas diked diker dikes dildo dilli dills dilly " +
  "dimer dimes dimly dimps dinar dined diner dines dinge dingo dings dingy dinic dinks dinky dinna dinos dints " +
  "diode diols diota dippy dipso direr dirge dirke dirks dirls dirts dirty disas disci disco discs dishy disks " +
  "disme ditas ditch dited dites ditsy ditto ditty ditzy divan divas dived diver dives divis divna divot divvy " +
  "diwan dixie dixit dixys diyas dizen dizzy djinn djins doabs doats dobby dobes dobie dobla dobra dobro docht " +
  "docks docos docus doddy dodge dodgy dodos doeks doers doest doeth doffs doggo doggy dogie dogma doily doing " +
  "doits dojos dolce dolci doled doles dolia dolls dolly dolma dolor dolos dolts domal domed domes domic donah " +
  "donas donee donga dongs donko donna donne donny donor donsy donut doobs dooce doody doofs dooks doole dools " +
  "dooly dooms doomy doona doorn doors doozy dopas doped doper dopes dopey dorad dorba dorbs doree dores doric " +
  "doris dorks dorky dorms dormy dorps dorrs dorsa dorse dorts dorty dosai dosas dosed doseh doser doses dosha " +
  "dotal doted doter dotes dotty douar doubt douce douch dough douks doula doums doups doura douse douts doved " +
  "doven dover doves dovie dowar dowds dowdy dowed dowel dower dowie dowle dowls downa downs downy dowps dowry " +
  "dowse dowts doxed doxes doxie doyen doyle dozed dozen dozer dozes drabs draco draff draft drags drail drain " +
  "drake drama drams drank drant drape draps drats drave drawl drawn draws drays dread dream drear dreck dreed " +
  "dreek dregs dreks drent dress drest drews dribs dried drier dries drift drill drily drink dript drive droid " +
  "droil droit droke drole droll drome drone drony drook drool droop drops dropt dross drouk drove drown drows " +
  "drubs drugs druid drums drunk drupe druse drusy druxy dryad dryas dryer dryly dsobo dsomo duads duals duane " +
  "duars dubbo ducal ducat duces duchy ducks ducky ducts duddy duded dudes duels duets duett dufus duing duits " +
  "dukas duked dukes dukka dulce dules dulia dulls dully dulse dumas dumbo dumbs dumka dumky dummy dumps dumpy " +
  "dunam dunce dunch dunes dungs dungy dunks dunno dunny dunts duomi duomo duped duper dupes duple duply duppy " +
  "dural duras dured dures durgy durns duroc duros duroy durra durrs durry durst durum durzi dusks dusky dusts " +
  "dusty dutch duvet duxes duyou dwaal dwale dwalm dwams dwang dwarf dwaum dweeb dwell dwelt dwile dwine dyads " +
  "dyers dying dykes dykey dykon dynel dynes dzhos eager eagle eared earls early earns earnt earst earth eased " +
  "easel eases easle easts eaten eater eaved eaves ebbed ebbet ebons ebony ebook ecads eched eches echos eclat " +
  "ecrus edema edged edger edges edict edify edile edits educe educt eensy eerie effed egads egers egest eggar " +
  "egged egger egmas ehing eider eidos eight eigne eikon eilds eisel eject ejido eking ekkas elain eland elans " +
  "elate elbow elchi elder eldin elect elegy elemi elfed elide elint elite elmen eloge elogy eloin elope elops " +
  "elpee elsin elude elute elvan elven elver elves emacs embar embay embed ember embog embow embus emcee emeer " +
  "emend emerg emery emeus emics emirs emits emmas emmer emmet emmew emmys emode emote emove empts empty emule " +
  "emure emyde emyds enact enarm enate ended ender endew endow endue enema enemy enews enfix eniac enjoy enlit " +
  "enmew ennog ennui enoki enols enorm enows ensew ensky ensue enter entia ently entry enure enurn envoi envoy " +
  "enzym eorls eosin epact epees ephah ephas ephod ephor epics epoch epode epopt epoxy epris equal eques equid " +
  "equip erase erbia erect erevs ergon ergos ergot erica erick erics ering erned ernes erode erose erred error " +
  "erses eruct erugo erupt eruvs ervil escar escot eskar esker esnes espla essay esses ester estoc estro etage " +
  "etape etats etens ethal ether ethic ethne ethos ethyl etics etnas ettin ettle etude etuis etwee etyma eughs " +
  "euked eupad euros eusol evade evens event evert every evets evhoe evict evils evite evohe evzon ewers ewest " +
  "ewhow exact exalt exams excel exeat execs exeem exeme exert exfil exies exile exine exing exist exits exode " +
  "exome exomy expat expel expos extol extra exude exuls exult exurb eyass eyers eying eyots eyras eyres eyrie " +
  "eyrir fabby fable faced facer faces facet faddy faded fader fades fadge fados faena faery faffs faffy faggy " +
  "fagin fagot faiks fails faine fains faint fairs fairy faith faked faker fakes fakey fakie fakir falaj falls " +
  "false famed fames fanal fancy fands fanes fanga fango fangs fanks fanny fanon fanos fanum faqir farad farce " +
  "farci farcy fards fared farer fares farle farls farms faros farro farse farts fasci fasti fasts fatal fated " +
  "fates fatly fatso fatty fatwa faugh fauld fault fauna fauns faurd fauts fauve favas favel faver faves favor " +
  "favus fawns fawny faxed faxes fayed fayer fayne fayre fazed fazes fears feart fease feast feats feaze fecal " +
  "feces fecht fecit fecks fedex feeas feebs feeds feels feens feers feese feeze fehme feign feint feist felch " +
  "felid fella fells felly felon felts felty femal femes femme femmy femur fence fends fendy fenis fenks fenny " +
  "fents feods feoff feral ferer feres feria ferly ferms ferns ferny ferry fesse festa fests fetal fetas fetch " +
  "feted fetes fetid fetor fetta fetts fetus fetwa feuar feuds feued fever fewer feyed feyer feyly fezes fezzy " +
  "fiars fiats fiber fibre fibro fices fiche fichu ficin ficos ficus fides fidge fidos fiefs field fiend fient " +
  "fiere fiers fiery fiest fifed fifer fifes fifis fifth fifty figgy fight figos fiked fikes filar filch filed " +
  "filer files filet filii filks fille fillo fills filly films filmy filos filth filum final finca finch finds " +
  "fined finer fines finis finks finny finos fiord fique fired firer fires firie firks firma firms firns firry " +
  "first firth fiscs fishy fisks fists fisty fitch fitly fitna fitte fitts fiver fives fixed fixer fixes fixit " +
  "fizzy fjeld fjord flabs flack flaff flags flail flair flake flaky flame flamm flams flamy flane flank flans " +
  "flaps flare flary flash flask flats flava flawn flaws flawy flaxy flays fleam fleas fleck fleek fleer flees " +
  "fleet flegs fleme flesh fleur flews flexi flexo fleys flick flics flied flier flies flimp flims fling flint " +
  "flips flirs flirt flisk flite flits flitt float flobs flock flocs floes flogs flong flood floor flops flora " +
  "flors flory flosh floss flota flote flour flout flown flows flubs flued flues fluey fluff fluid fluke fluky " +
  "flume flump flung flunk fluor flurr flush flute fluty fluyt flyby flyer flype flyte foals foams foamy focal " +
  "focus foehn fogey foggy fogie fogle fogou fohns foids foils foins foist folds foley folia folic folie folio " +
  "folks folky folly fomes fonda fonds fondu fones fonts foods foody fools foots footy foram foray forbs forby " +
  "force fordo fords fored fores forex forge forgo forks forky forme forms forte forth forts forty forum forza " +
  "forze fossa fosse fouat fouds fouer fouet fouls found fount fours fouth fovea fowls fowth foxed foxes foxie " +
  "foyer foyle foyne frabs frack fract frags frail fraim frame franc frank frape fraps frass frate frati frats " +
  "fraud fraus frays freak freed freer frees freet freit fremd frena freon frere fresh frets friar fribs fried " +
  "frier fries frigs frill frims frise frist frith frits fritt fritz frize frizz frock froes frogs frond frons " +
  "front frore frorn frory frosh frost froth frown frows frowy froze frugs fruit frump frush fryer fubar fubby " +
  "fubsy fucks fucus fuddy fudge fuels fuero fuffs fuffy fugal fugie fugio fugle fugly fugue fujis fulls fully " +
  "fumed fumer fumes fumet fundi funds fundy fungi fungo fungs funjs funks funky funny fural furan furca furls " +
  "furol furor furrs furry furth furze furzy fused fusee fusel fuses fusil fussy fusts fusty futon fuyed fuzed " +
  "fuzee fuzes fuzil fuzzy fyces fyked fykes fyles fyrds fytte gabba gabby gable gaddi gades gadge gadid gadis " +
  "gadje gadjo gadso gaffe gaffs gaged gager gages gaids gaily gains gairs gaita gaits gaitt gajos galah galas " +
  "galax gales galls gally galop galut galvo gamas gamay gamba gambe gambo gambs gamed gamer games gamey gamic " +
  "gamin gamma gamme gammy gamps gamut ganch gandy ganef ganev gangs ganja ganof gants gaols gaped gaper gapes " +
  "gappy garbe garbo garbs garda gardz gares garis garms garni garre garth garum gases gasps gaspy gassy gasts " +
  "gatch gated gater gates gaths gator gauch gaucy gauds gaudy gauge gauje gault gaums gaumy gaunt gaups gaurs " +
  "gauss gauze gauzy gavel gavot gawcy gawds gawks gawky gawps gawsy gayal gayer gayly gazal gazar gazed gazer " +
  "gazes gazon gazoo geals geans geare gears geats gebur gecko gecks geeks geeky geeps geese geest geist geits " +
  "gelan gelds gelee gelid gelly gelts gemel gemma gemmy gemot genal genas genes genet genic genie genip genny " +
  "genoa genom genre genro gents genty genua genus geode geoid gerah gerbe geres gerle germs germy gerne gesse " +
  "gesso geste gests getas getup geums ghast ghats ghaut ghazi ghees ghest ghost ghoul ghyll giant gibed giber " +
  "gibes gibli gibus giddy gifts gigas gighe gigot gigue gilas gilds gilet gills gilly gilpy gilts gimel gimme " +
  "gimps gimpy ginch ginge gings ginks ginny ginzo gipon gippo gippy gipsy girds girls girly girns giron giros " +
  "girrs girsh girth girts gismo gites giust gived given giver gives gizmo glace glade glads glady glaik glair " +
  "glams gland glans glare glary glass glaum glaur glaze glazy gleam glean gleba glebe gleby glede gleds gleed " +
  "gleek glees gleet gleis glens gleys glial glias glibs glide gliff glift glike glime glims glint glisk glits " +
  "glitz gloam gloat globe globi globs globy glode gloea gloff gloms gloom gloop glops glory gloss glost glout " +
  "glove glows gloze glued gluer glues gluey glugs gluma glume glums gluon glute gluts glyph gnarl gnarr gnars " +
  "gnash gnats gnawn gnaws gnome gnows goads goafs goals goary goats goaty goban gobar gobbi gobbo gobby gobis " +
  "goble gobos godet godly goels goers goest goeth goety gofer goffs gogga gogos going gojis golds goldy golem " +
  "goles golfs golly golpe golps gombo gomer gompa gonad gonch gonef goner gongs gonia gonif gonks gonna gonof " +
  "gonys gonzo goods goody gooey goofs goofy googs gools gooly goons goony goops goopy goora goors goory goose " +
  "goosy gopak gopik goral goras gorbs gordo gored gores gorge goris gorms gormy gorps gorse gorsy gosht gosse " +
  "goths gotta gouch gouge gourd gours gouts gouty gowan gowds gowfs gowks gowls gowns goxes goyim goyle graal " +
  "grabs grace grade grads graff graft grail grain graip grama gramp grams grana grand grans grant grape graph " +
  "grapy grasp grass grate grave gravs gravy grays graze great grebe grebo grece greed greek green grees greet " +
  "grege grego greim grein grens grese greve grews greys grice gride grids grief griff grift grigs grike grill " +
  "grime grimy grind grins griot gripe grips gript gripy grise grist grith grits groan groat grody grogs groin " +
  "groks groma groms grone groof groom groot grope gross grosz grots grouf group grout grove grovy growl grown " +
  "grows grrls grrrl grubs gruel grues gruff gruft grume grump grund grunt gryce gryde gryke gryph guaco guana " +
  "guano guans guard guars guava gucks gucky gudes guess guest guffs guide guids guild guile guilt guimp guiro " +
  "guise gulag gular gulas gulch gules gulet gulfs gulfy gulls gully gulph gulps gulpy gumbo gummi gummy gumps " +
  "gunge gungy gunks gunky gunny guppy gurdy gurge gurke gurks gurls gurly gurns gurry gursh gurus gushy gusla " +
  "gusle gusli gussy gusto gusts gusty gutsy gutta gutty guyle guyot guyse gwine gyals gybed gybes gyeld gymps " +
  "gynae gynie gynny gypos gyppo gyppy gypsy gyral gyred gyres gyron gyros gyrus gythe haafs haars habit hable " +
  "habus hacek hacks hadal haded hades hadji hadst haems haets haffs hafiz hafts hahas haick haika haiks haiku " +
  "hails haily hains haint hairs hairy haith hajes hajis hajji hakam hakas hakea hakes hakim hakus halal haled " +
  "haler hales halfa halfs halid hallo halls halma halms halon halos halse halts halva halve halwa hamal hamba " +
  "hamed hames hammy hamza hanap hance hanch hands handy hangi hangs hanks hanky hansa hanse hants haole haoma " +
  "hapax haply happi happy hapus haram hards hardy hared harem hares harim harks harls harms harns haros harps " +
  "harsh harts hasks hasky hasps hasta haste hasty hatch hated hater hates hatha haugh hauld haulm hauls hault " +
  "haunt hause haute haven havoc hawed hawks hawse hayed hayer hayle hazan hazed hazel hazer hazes heads heady " +
  "heald heals heame heaps heapy heard heare hears heart heast heath heats heave heavy hebes hecht hecks heder " +
  "hedge hedgy heeds heedy heels heeze hefte hefts hefty heids heigh heils heirs heist hejab hejra heled heles " +
  "helio helix hello hells helms helos helot helps helve hemal hemes hemic hemin hemps hempy hence hench hends " +
  "henge henna henny henry hents herbs herby herds herem heres herls herma herms herns heron heros herry hertz " +
  "herye hests heths heuch heugh hevea hewed hewer hewgh hexad hexed hexer hexes hexyl heyed hiant hicks hided " +
  "hider hides hiems highs hight hijab hijra hiked hiker hikes hikoi hilar hilch hillo hills hilly hilts hilum " +
  "hilus himbo hinau hinds hinge hinky hinny hints hiois hiply hippo hippy hired hiree hirer hires hissy hists " +
  "hitch hithe hived hiver hives hizen hoaed hoagy hoard hoars hoary hoast hobby hocks hocus hodad hoddy hoers " +
  "hogen hoggs hoick hoied hoise hoist hokas hoked hokes hokey hokis hokku hokum holds holed holes holey holks " +
  "holla hollo holly holme holms holon holos holts homas homed homer homes homey homie homme homos honan honda " +
  "honds honed honer hones honey hongi hongs honks honky honor hooch hoods hoody hooey hoofs hooka hooks hooky " +
  "hooly hoons hoops hoord hoors hoosh hoots hooty hoove hopak hoped hoper hopes hoppy horah horal horas horde " +
  "horis horks horme horns horny horse horst horsy hosed hosel hosen hoser hoses hosey hosta hosts hotch hotel " +
  "hoten hotly hotty houff houfs hough hound houri hours house houts hovea hoved hovel hoven hover hovet howbe " +
  "howdy howes howff howfs howks howls howre howso howto hoxed hoxes hoyas hoyed hoyle hubby hucks huers huffs " +
  "huffy huger hujah hulas hules hulks hulky hullo hulls human humas humfs humic humid humor humph humps humpy " +
  "humus hunch hunks hunky hunts hurds hurls hurly hurra hurry hurst hurts hushy husks husky husos hussy hutch " +
  "huzza huzzy hwyls hydro hyena hyens hying hykes hylas hyleg hyles hylic hymen hymns hynde hyoid hyped hyper " +
  "hypes hypha hyphy hypos hyrax hyson hythe iambi iambs ibrik icers iched iches ichor icier icily icing icker " +
  "ickle icons ictal ictic ictus ideal ideas idees ident idiom idiot idled idler idles idola idols idyll idyls " +
  "iftar igapo igged igloo iglus ihram ileac ileal ileum ileus iliac iliad ilial ilium iller image imago imams " +
  "imari imaum imbar imbed imbue imide imido imids imine imino immew immit immix imped impel impis imply impot " +
  "impro imshi imshy inane inank inarm inbox inbye incel incog incur incus incut indew index india indie indol " +
  "indow indri indue inept inerm inert infer infix infos infra ingan ingle ingot inion inked inker inkle inlay " +
  "inlet inned inner inorb input inrun insee inset insol inspo intel inter intil intis intra intro inula inure " +
  "inurn invar inwit ioads iodic iodid iodin ionic iotas ippon irade irate irids iring irked iroko irone irons " +
  "irony isbas ischa ishes isled isles islet isnae issei issue istle italy itchy items ither ivied ivies ivory " +
  "ixias ixnay ixora ixtle izard izars izzat jaaps jabot jacal jacks jacky jaded jades jagas jager jaggs jaggy " +
  "jagir jagra jails jaker jakes jakey jalap jalop jambe jambo jambs jambu james jammy jamon janes janns janny " +
  "janty japan japed japer japes jarls jarps jarta jarul jasey jaspe jasps jatos jauks jaune jaups javas javel " +
  "jawan jawed jaxie jazzy jeans jeats jebel jedis jeels jeely jeeps jeers jefes jeffs jehad jehus jelab jello " +
  "jells jelly jembe jemmy jenny jeons jerid jerks jerky jerry jesse jests jesus jetes jeton jetty jeune jewed " +
  "jewel jewie jhala jiaos jibba jibbs jibed jiber jibes jiffs jiffy jiggy jigot jihad jills jilts jimmy jimpy " +
  "jingo jinks jinne jinni jinns jirds jirga jirre jisms jived jiver jives jivey jnana jobed jobes jocko jocks " +
  "jocky jocos jodel joeys johns joins joint joist joked joker jokes jokey jokol joled joles jolls jolly jolts " +
  "jolty jomon jomos jones jongs jonty jooks joram jorum jotas jotty jotun joual jougs jouks joule jours joust " +
  "jowar jowed jowls jowly joyed jubas jubes jucos judas judge judos jugal jugum juice juicy jujus juked jukes " +
  "jukus julep jumar jumbo jumby jumps jumpy junco junip junks junky junos junta junto jupes jupon jural jurat " +
  "jurel juror justs jutes jutty juves juvie kaama kabab kabar kabob kacha kacks kadai kades kadis kafir kagos " +
  "kagus kahal kaiak kaids kaies kaifs kaika kaiks kails kaims kaing kakas kakis kalam kales kalif kalis kalpa " +
  "kamas kames kamik kanae kanas kandy kaneh kanes kanga kangs kanji kaons kapas kaphs kapok kapow kappa kapur " +
  "kapus karas karat karks karma karns karoo karos karri karst karsy karts karzy kasha kasme katal katas katis " +
  "katti kaugh kauri kauru kavas kawas kawau kawed kayak kayle kayos kazis kbars kebab kebar kebob kecks kedge " +
  "kedgy keech keefs keeks keels keema keeno keens keeps keets keeve kefir kehua keirs keist keits kelep kelim " +
  "kells kelly kelps kelpy kelts kelty kembo kembs kemps kempt kempy kenaf kench kendo kenos kente kents kepis " +
  "kerbs kerel kerfs kerky kerma kerne kerns keros kerry kerve kesar kests ketas ketch ketes ketol kevel kevil " +
  "kexes keyed keyer khadi khafs khaki khans khaph khats kheda kheth khets khoja khors khoum khuds kiang kibbe " +
  "kibbi kibei kibes kibla kicks kicky kiddo kiddy kiefs kiers kieve kight kikes kikoi kilim kills kilns kilos " +
  "kilps kilts kilty kimbo kinas kinda kinds kindy kines kings kinin kinks kinky kinos kiore kiosk kipes kippa " +
  "kipps kirby kirks kirns kirri kissy kists kited kiter kites kithe kiths kitty kitul kivas kiwis klang klaps " +
  "klett klick klieg kliks klong kloof kluge klutz knack knags knaps knapt knars knave knawe knead kneed kneel " +
  "knees knell knelt knife knish knits knive knobs knock knoll knops knosp knots knout knowe known knows knubs " +
  "knurl knurr knurs knuts koala koans koaps koban kobos koels koffs kofta kohas kohen kohls koine kojis kokam " +
  "kokas kokra kokum kolas kolos kombu konks kooky koori kopek kophs kopje koppa korai koran koras korat korma " +
  "koros korun korus kosas koses kotch kotos kotow kouro koyan kraal krabs kraft krais krait krang krans krays " +
  "kreep krena kreng krewe krill krona krone kroon krubi kruse ksars kubie kudos kudus kudzu kufis kugel kuias " +
  "kukri kukus kulak kulan kulas kulfi kumis kumys kuras kurde kurta kurus kusso kutas kutch kutis kutus kuzus " +
  "kvass kvell kwela kyack kyaks kyang kyars kyats kydst kyles kylie kylin kylix kyloe kynde kynds kypes kyrie " +
  "kytes kythe laari labda label labia labis labor labra laced lacer laces lacet lacey lacis lacks laddu laded " +
  "laden lader lades ladle laers laevo lagan lagar lager lahal lahar laich laics laids laigh laika laiks laird " +
  "lairs lairy laith laity laked laker lakes lakhs laksa lalls laltu lamas lambi lambs lamby lamed lamer lames " +
  "lamia lammy lamps lanai lanas lance lanch lande lands lanes lanex lange langs lanky lants lapel lapin lapis " +
  "lapje lapse larch lards lardy lares large largo laris larks larky larns larnt larum larva lased laser lases " +
  "lasso lassu lassy lasts latah latch lated laten later latex lathe lathi laths lathy latke latte lauan lauch " +
  "lauds laufs laugh laund laura laval lavas laved laver laves lavra lavvy lawed lawer lawin lawks lawns lawny " +
  "laxed laxer laxes laxly layed layer layin layup lazar lazed lazes lazos lazzi lazzo leach leads leady leafs " +
  "leafy leaks leaky leams leans leant leany leaps leapt leare learn lears leary lease leash least leats leave " +
  "leavy leaze leben leccy ledes ledge ledgy ledum leear leech leeks leeps leere leers leery leese leets lefte " +
  "lefts lefty legal leges legge leggo leggy legit lehrs lehua leirs leish leman lemed lemel lemes lemma lemmy " +
  "lemon lemur lends lenes lenge lengs lenis lenos lense lenti lento leone leper lepid lepra lepta lered leres " +
  "lerps lesbo leses lests letch lethe letts letup leuch leuco leuds leugh levas levee level lever leves levin " +
  "levis lewis lexes lexis lezes lezza lezzy liais liana liane liang liara liard liars liart liber libra libri " +
  "lichi licht licit licks lidar lidos liefs liege liens liers lieus lieve lifer lifes lifts ligan liger ligge " +
  "light ligne likas liked liken liker likes likin lilac lills lilos lilts lilty liman limas limax limba limbi " +
  "limbo limbs limby limed limen limes limey limit limma limns limos limpa limps linac linch linda linds lindy " +
  "lined linen liner lines liney linga lingo lings lingy linin links linky linns linny linos lints linty linum " +
  "linux lions lipas lipes lipid lipin lipos lippy liras lirks lirot lisks lisle lisps lists litai litas lited " +
  "liter lites lithe litho liths litre lived liven liver lives livid livor livre llama llano loach loads loafs " +
  "loams loamy loans loast loath loave lobar lobby lobed lobes lobos local lochs locie locis locks locos locum " +
  "locus loden lodes lodge loess lofts lofty logan loges loggy logia logic logie login logoi logon logos loids " +
  "loins lokes lolls lolly lolog lomas lomed lomes loner longa longe longs looby looed looey loofa loofs looie " +
  "looks looky looms loons loony loops loord loose loots loped loper lopes loppy loral loran lords lordy lorel " +
  "lores loric loris lorry losed losel losen loser loses lossy lotah lotas lotes lotic lotos lotsa lotta lotte " +
  "lotto lotus louch loued lough louie louis louma lound louns loupe loups loure lours loury louse lousy louts " +
  "lovat loved lover loves lovey lovie lowan lowed lower lowes lownd lowne lowns lowps lowry lowse lowts loxed " +
  "loxes loyal lozen luach luaus lubed lubes lubra luces lucid lucks lucky lucre luded ludes ludic ludos luffa " +
  "luffs luger luges lulls lulus lumas lumbi lumen lumme lummy lumps lumpy lunar lunas lunch lunes lunet lunge " +
  "lungi lungs lunks lunts lupin lupus lurch lured lurer lures lurex lurgi lurid lurks lurry lurve luser lushy " +
  "lusks lusts lusty lusus lutea luted luter lutes luvvy luxed luxer luxes lweis lyams lyard lyart lyase lycea " +
  "lycee lycra lying lymes lymph lynch lynes lyres lyric lysed lyses lysin lysis lysol lyssa lyted lytes lythe " +
  "lytic lytta maaed maare maars mabes macas macaw maced macer maces mache machi macho machs macje macks macle " +
  "macon macro madam madge madid madly madre mafia mafic mages maggs magic magma magot magus mahoe mahua mahwa " +
  "maids maiko maile maill mails maims mains maire mairs maise maist maize major makar maker makes makis makos " +
  "malam malar malas malax maled males malic malik malis malls malms malmy malts malty malus malva malwa mamas " +
  "mamba mambo mamee mamey mamie mamma mammy manas manat mandi mands mandy maneb maned maneh manes manet manga " +
  "mange mango mangs mangy mania manic manis manky manly manna manor manos manse manta manto manty manul manus " +
  "mapau maple maqui marae marah maras march marcs mardy mares marga marge margs maria marid marka marks marle " +
  "marls marly marms maron maror marra marri marry marse marsh marts marvy masas mased maser mases masha mashy " +
  "masks mason massa masse massy masts masty masus matai match mated mater mates matey maths matin matlo matra " +
  "matsu matte matts matza matzo mauby maugh mauls maund mauri mauts mauve mauzy maven mavie mavin mavis mawks " +
  "mawky mawns mawrs maxed maxes maxim maxis mayan mayas maybe mayed mayor mayos mayst mazed mazer mazes mazey " +
  "mazut mbira meads meals mealy means meant meare mease meath meats meaty meble mecca mechs mecks medal media " +
  "medic medii medle meeds meeks meers meets meffs meign meiny meith mekka melas melba melds meles melic melik " +
  "mells melon melts melty memes memos menad mends mened menes menge mengs mensa mense mensh menta mento menus " +
  "meous meows merch mercs mercy merde merel merer meres merge merit merks merle merls merry merse mesal mesas " +
  "mesel meses meshy mesic mesil mesne meson messy metal meted meten meter metes metho meths metic metif metis " +
  "metol metre metro mette meuse meved meves mewed mewls meynt mezes mezze mezzo mhorr miaou miaow miasm miaul " +
  "mibun micas miche micht micks micky micos micra micro middy midge midgy midis midst miens mieve miffs miffy " +
  "miggs might mihas mihis miked mikes mikra mikva milch milds mildy miler miles milfs milia milko milks milky " +
  "mille mills milor milos milpa milts milty mimed mimeo mimer mimes mimic mimsy minae minar minas mince mincy " +
  "minds mined miner mines minge mings mingy minim minis minke minks minny minor mints minty minus mired mires " +
  "mirex mirid mirin mirks mirky mirly miros mirth mirvs mirza misch misdo miser mises misgo misos missa misty " +
  "mitch miter mites mitis mitre mitts mixed mixen mixer mixes mixte mixup mizen mizzy mneme moans moats mobby " +
  "mobed mobes mobie moble mocha mochi mochs mochy mocks modal model modem moder modes modge modii modus moers " +
  "mofos moggy mogul mohel mohrs mohua mohur moils moira moire moist moits mojos mokes mokis mokos molal molar " +
  "molas molds moldy moled moles molla molls molly molto molts molys momes momma mommy momus monad monal monas " +
  "monde mondo money mongo mongs monic monie monks monos monte month monty mooch moods moody mooed mooks moola " +
  "mooli mools mooly moong moons moony moops moors moory moose moots moove moped moper mopes mopey moppy mopsy " +
  "mopus morae moral moras moray morel mores moria morne morns moroc moron morph morra morro morse morts mosed " +
  "moses mosey mosks mosso mossy moste mosts moted motel moten motes motet motey moths mothy motif motis motor " +
  "motte motto motts motty motus motza mouch moues mould mouls moult mound mount moups mourn mouse moust mousy " +
  "mouth moved mover moves movie mowas mowed mower mowra moxas moxie moyas moyle moyls mozed mozes mozos mpret " +
  "mucho mucic mucid mucin mucks mucky mucor mucro muddy mudge mudir mudra muffs mufti mugga muggs muggy muhly " +
  "muids muils muirs muist mujik mulch mulct muled mules muley mulga mulie mulla mulls mulse mulsh mumms mummy " +
  "mumps mumsy mumus munch munga mungo mungs munis munts muntu muons mural muras mured mures murex murid murks " +
  "murky murls murly murra murre murrs murry murti murva musar musas mused muser muses muset musha mushy music " +
  "musit musks musky musos musse mussy musth musts musty mutch muted muter mutes mutha mutis muton mutts muxed " +
  "muxes muzak muzzy mvule myall mylar mynah mynas myoid myoma myope myops myopy myrrh mysid mythi myths mythy " +
  "myxos mzees naams nabes nabis nabla nabob nache nacho nacre nadas nadir naeve naevi naffs naggy nagor naiad " +
  "naieg naiks nails naira nairu naive naked naker nakfa nalas nalla namaz named namer names namma namus nanas " +
  "nance nancy nandu nanna nanny napas naped naper napes nappa nappe nappy naras narco narcs nards nardu nares " +
  "naric naris narks narky narre nasal nashi nasty natal natch nates natis natty nauch naunt naval navar navel " +
  "naves navew navvy nawab nazes nazir nazis neafe neals neaps nears neath neats nebek nebel necks neddy needs " +
  "needy neeld neele neemb neems neeps neese neeze nefas negus neifs neigh neist neive nelis nelly nemas nemns " +
  "nempt nenes neons neper neppy nerds nerdy nerka nerks nerol nerts nertz nerve nervy nests netes netop netts " +
  "netty neuks neume neums never neves nevus newbs newed newel newer newie newly newsy newts nexts nexus ngana " +
  "ngati ngoma nguni ngwee nicad nicer niche nicht nicks nicol nidal nided nides nidor nidus niece niefs nieve " +
  "nifes niffs niffy nifty nighs night nihil nikab nikau nills nimbi nimbs nimps niner nines ninja ninny ninon " +
  "ninth nipas nippy niqab nirls nirly nisei nisse nisus niter nites nitid niton nitre nitro nitry nitty nival " +
  "nixed nixes nixie nizam noahs nobby noble nobly nocks nodal noddy nodes nodus noels noggs nohow noils noily " +
  "noint noirs noise noisy noles nolls nolos nomad nomas nomen nomes nomic nomoi nomos nonas nonce nones nonet " +
  "nonis nonny nonyl nooit nooks nooky noons noops noose nopal noria noris norks norma norms north nosed noser " +
  "noses nosey notal notch noted noter notes notum nould nouls nound nouns noups novae novas novel novum noway " +
  "nowed nowls nowts nowty noxal noxes noyau noyed noyes nubby nubia nucha nuddy nuder nudes nudge nudie nudzh " +
  "nuffs nugae nuked nukes nulla nulls numbs numen nummy nuncs nurds nurdy nurls nurrs nurse nutso nutsy nutty " +
  "nyaff nyala nying nylon nymph oaked oaken oaker oakum oared oases oasis oasts oaten oater oaths obang obeah " +
  "obeli obese obeys obias obied obits objet oboes obole oboli obols occam occur ocean ocher oches ochre ochry " +
  "ocker ocrea octad octal octan octas octet octyl oculi odahs odals odder oddly odeon odeum odism odist odium " +
  "odors odour odyle odyls ofays offal offed offer offie often ofter ogams ogeed ogham ogive ogled ogler ogles " +
  "ogmic ogres ohias ohing ohmic ohone oidia oiked oikos oiled oiler oinks oints okapi okays okehs okras oktas " +
  "olant olden older oldie oldly oleic olein olent oleos oleum olios olive ollav oller ollie ology ololo omasa " +
  "omber ombre ombus omega omens omers omits omlah omovs omrah oncer onces oncet oncus onely onery onion onium " +
  "onkus onlay onned onset ontic oobit oohed oomph oonts ooped oorie ootid oozed oozes opahs opals opens opepe " +
  "opera opine oping opium oppos opsin opted opter optic orach oracy orals orang orant orate orbed orbit orcas " +
  "orcin order ordos oread orfes organ orgia orgic orgue oribi oriel orixa orles orlon orlop ormer ornis orpin " +
  "orris ortho orval orzos oscar osela oshac osier osmic osmol ossia ostia otaku otary other ottar otter ottos " +
  "oubit oucht oughs ought ouija oulks oumas ounce oupas ouped ouphe ouphs ourie ousel ousts outby outdo outed " +
  "outer outgo outre outro outta ouzel ouzos ovals ovary ovate ovels ovens overs overt ovine ovist ovoid ovoli " +
  "ovolo ovule owche owers owies owing owled owler owlet owned owner owres owrie owsen oxbow oxers oxeye oxide " +
  "oxids oxies oxime oxims oxlip oxter oyers oyses ozeki ozone ozzie paals paans pacas paced pacer paces pacey " +
  "pacha packs pacos pacta pacts paddy padis padle padma padre padri paean paedo paeon pagan paged pager pages " +
  "pagle pagod pagri paiks pails pains paint paire pairs paisa paise pakka palay palea paled paler pales palet " +
  "palis palki palla palls pally palms palmy palpi palps palsa palus pampa panax pance panda pandy paned panel " +
  "panes panga pangs panic panim panko panne panto pants panty papal papas papaw paper papes pappi pappy papus " +
  "parae paras parch pardi pardo pards pardy pared paren pareo parer pares pareu parev parge pargo paris parka " +
  "parki parks parky parle parly parol parps parra parrs parry parse parti parts party parve parvo paseo pases " +
  "pasha pashm passe pasta paste pasts pasty patch pated paten pater pates paths patin patio patka patly patsy " +
  "patte patty patus pauas pauls pause pavan paved paven paver paves pavid pavin pavis pawas pawaw pawed pawer " +
  "pawks pawky pawls pawns paxes payed payee payer payor pazaz peace peach peage peags peaks peaky peals peans " +
  "pearl peart pease peats peaty peavy peaze pebas pecan pechs pecke pecks pedal pedes pedis pedro peece peeks " +
  "peeky peele peels peens peeps peepy peers peery peese peeve peggy peghs peins peise peize pekan pekau pekes " +
  "pekin pelas peles pelfs pella pells pelma pelon pelta pelts penal pence pench pends pendu pened penes pengo " +
  "penie penis penks penna penne penni penny pents peons peony pepla pepos peppy pepsi perai perca perce perch " +
  "percs perdu perdy perea peres peril peris perks perky perms perns perog perps perse perst perts perve pervo " +
  "pervs pervy pesky pesto pests pesty petal petar peter petit petre petri petti petto petty pewee pewit phage " +
  "phang pharm phase pheer phene pheon phese phial phish phizz phlox phoca phone phono phons phony photo phots " +
  "phpht phuts phyla phyle piani piano pians pibal pical picas piccy picks picky picot picra picul piece piend " +
  "piers piert pieta piets piety piezo piggy pight pigmy piing pikas piked piker pikes pikey pikis pikul pilae " +
  "pilaf pilao pilar pilau pilaw pilch pilea piled pilei piler piles pilis pills pilot pilow pilum pilus pimas " +
  "pimps pinas pinch pined pines piney pingo pings pinko pinks pinky pinna pinny pinon pinot pinta pinto pints " +
  "pinup pions piony pious pioye pioys pipal pipas piped piper pipes pipet pipis pipit pippy pipul pique pirai " +
  "pirls pirns pirog pisco piser pisky pisos pissy piste pitas pitch piths pithy piton pitta piums pivot pixel " +
  "pixes pixie pized pizes pizza plaas place plack plage plaid plain plait plane plank plans plant plaps plash " +
  "plasm plast plate plats platt platy playa plays plaza plead pleas pleat plebe plebs plena pleon plesh plews " +
  "plica plied plier plies plims pling plink plods plomb plong plonk plook ploom plops plots plotz plouk plows " +
  "ploye ploys pluck plued plues pluff plugs plumb plume plump plums plumy plunk pluot plush pluto plyer poach " +
  "poaka poake poboy pocks pocky podal poddy podex podge podgy podia poems poesy poets pogey pogge pogos pohed " +
  "poilu poind point poise pokal poked poker pokes pokey pokie polar poled poler poles poley polio polis polje " +
  "polka polks polls polly polos polts polyp polys pomes pommy pomos pomps ponce poncy ponds pones poney pongo " +
  "pongs pongy ponks ponts ponty ponzu pooch poods pooed poofs poofy poohs pooja pooka pooks pools poons poops " +
  "poori poort poove popes poppa poppy popsy porae poral porch pored porer pores porge porgy porks porky porno " +
  "porns porny ports porty posed poser poses poset posey posho posit posse poste posts potae potch poted potes " +
  "potin potoo potsy potto potts potty pouch pouff poufs poufy pouke pouks poule poulp poult pound poupe poupt " +
  "pours pouts pouty powan power powin pownd powns powny powre poxed poxes poyou poyse pozzy praam prads prahu " +
  "prams prana prang prank praos prase prats pratt praty praus prawn prays preda preen prees preif prems premy " +
  "prent preop preps presa prese press prest preta prets prexy preys prial price prich prick pricy pride pried " +
  "prief prier pries prigs prill prima prime primi primo primp prims primy prink print prion prior prise prism " +
  "priss privy prize proas probe probs prods proem profs progs proin proke prole proll promo proms prone prong " +
  "pronk proof props prore prose proso pross prost prosy proto proud proul prove prowl prows proxy prude prune " +
  "prunt pruta pryer pryse psalm pseud pshaw psion psoae psoai psoas psora psych psyop pubco pubes pubic pubis " +
  "pucan pucer puces pucka pucks puddy pudge pudgy pudic pudor pudsy pudus puers puffa puffs puffy puggy pugil " +
  "pujah pujas puked puker pukes pukey pukus puled puler pules pulik pulis pulka pulks pulli pulls pully pulmo " +
  "pulps pulpy pulse pulus pumas pumie pumps punas punce punch punga pungs punji punka punks punky punny punto " +
  "punts punty pupae pupal pupas puped pupil puppy pupus purda pured puree purer pures purga purge purin puris " +
  "purls purrs purse pursy purty puses pushy pusle putid puton putti putto putts putty puzel pwned pyats pyets " +
  "pygal pygmy pyins pylon pyned pynes pyoid pyots pyral pyran pyres pyrex pyric pyros pyxed pyxes pyxie pyxis " +
  "pzazz qadis qaids qajaq qanat qapik qibla qophs quack quads quaff quags quail quair quais quake quaky quale " +
  "qualm quant quare quark quart quash quasi quass quate quats quayd quays qubit quean queen queer quell queme " +
  "quena quern query quest queue queyn queys quich quick quids quiet quiff quill quilt quims quina quine quink " +
  "quins quint quipo quips quipu quire quirk quirt quist quite quits quods quoif quoin quoit quoll quonk quops " +
  "quota quote quoth qursh quyte raads raash rabat rabbi rabic rabid rabis raced racer races rache racks racon " +
  "radar radge radii radio radix radon raffs rafts ragas raged ragee rager rages ragga raggs raggy ragis ragus " +
  "rahed raias raids raiks raile rails raine rains rainy raird raise raita raits rajah rajas rajes raked rakee " +
  "raker rakes rakia rakis rakus rales rally ralph ramal ramee ramen ramet ramie ramin ramis rammy ramon ramps " +
  "ramus ranas rance ranch rands randy ranee range rangi rangs rangy ranid ranis ranke ranks rants raped raper " +
  "rapes raphe rapid rappe rared raree rares rarks rased raser rases rasps raspy rasta ratal ratan ratas ratch " +
  "rated ratel rater rates rathe raths ratio ratoo ratos ratty ratus rauns raupo raved ravel raven raves ravey " +
  "ravin rawer rawin rawly rawns raxed raxes rayah rayas rayed rayle rayne rayon razed razee razer razes razoo " +
  "razor reach react readd reads ready reaks realm reals reame reams reamy reans reaps reard rears reast reata " +
  "reate reave rebar rebbe rebec rebel rebid rebit rebop rebus rebut rebuy recal recap recce recco reccy recit " +
  "recks recon recta recti recto recur recut redan redds reddy reded redes redia redid redip redly redon redos " +
  "redox redry redub redux redye reech reede reeds reedy reefs reefy reeks reeky reels reens reest reeve refed " +
  "refel refer reffo refis refit refix refly refry regal regar reges reget regie regma regna regos rehab reice " +
  "reign reiki reiks reink reins reird reist reive rejig rejon reked rekes rekey relax relay relet relic relie " +
  "relit reman remap remen remet remex remit remix renal renay rends reney renga renig renin renne renos rente " +
  "rents reoil reorg repay repeg repel repin repla reply repos repot repps repro reran rerig rerun resat resaw " +
  "resay resee reses reset resew resid resin resit resod resol resow resto rests resty retag retax retch retem " +
  "retia retie retin retox retro retry reune reups reuse revel revet revie rewan rewax rewed rewet rewin rewon " +
  "rewth rexes rezes rfree rheas rheme rheum rhies rhime rhine rhino rhody rhomb rhone rhumb rhyme rhyne rhyta " +
  "rials riant riata ribas ribby ribes riced ricer rices ricey richt ricin ricks rider rides ridge ridgy riels " +
  "rieve rifer riffs rifle rifte rifts rifty right rigid rigol rigor riled riles riley rille rills rimae rimed " +
  "rimer rimes rimus rinde rinds rindy rines ringe rings rinks rinse rioja riots riped ripen riper ripes ripps " +
  "risen riser rises rishi risks risky risps risus rites ritts ritzy rival rived rivel riven river rives rivet " +
  "riyal rizas roach roads roams roans roars roary roast robed robes robin roble robot rocks rocky roded rodeo " +
  "rodes roger rogue roguy rohes roids roils roily roins roist rojak rojis roked rokee roker rokes rolag roles " +
  "rolfs rolls romal roman romeo romps rondo roneo rones ronin ronne ronte ronts roods roofs roofy rooks rooky " +
  "rooms roomy roons roops roopy roosa roose roost roots rooty roped roper ropes ropey roque roral rores roric " +
  "rorid rorie rorts rorty rosed roses roset roshi rosin rosit rosti rosts rotal rotan rotas rotch roted rotes " +
  "rotis rotls rotor rotos rotte rouen roues rouge rough roule rouls roums round roups roupy rouse roust route " +
  "routh routs roved roven rover roves rowan rowdy rowed rowel rowen rower rowie rowme rownd rowte rowth rowts " +
  "royal royne royst rozet rozit ruana rubai ruban rubby rubel rubes rubin ruble rubli rubus ruche rucks rudas " +
  "rudds ruddy ruder rudes rudie rudis rueda ruers ruffe ruffs rugae rugal rugby ruger ruggy ruing ruins rukhs " +
  "ruled ruler rules rumal rumba rumbo rumen rumes rumly rummy rumor rumpo rumps rumpy runch runds runed runes " +
  "rungs runic runny runts runty rupee rupia rural rurps rurus rusas ruses rushy rusks rusma russe rusts rusty " +
  "ruths rutin rutty ryals rybat ryked rykes rymme rynds ryots ryper saags sabal sabed saber sabes sabha sabin " +
  "sabir sable sabot sabra sabre sacks sacra saddo saddt sades sadhe sadis sadly sados sadza safed safer safes " +
  "sagas sager sages sagos sagum saheb sahib saice saick saics saids saiga sails saily saims saine sains saint " +
  "saith sajou sakai saker sakes sakia salad salal salat salep sales salet salic salix salle sally salmi salol " +
  "salon salop salpa salps salsa salse salts salty salue salut salve salvo samaj saman sambo samek samel samen " +
  "sames samey samfu sammy sampi samps sands sandy saned saner sanes sanga sangh sango sangs sanko sansa santo " +
  "saola sapan sapid sapor sappy saran sards sared sarge sargo saris sarks sarky sarod saros sarus saser sasin " +
  "sasse sassy satai satay sated satem sates satin satis satyr sauba sauce sauch saucy saugh sauls sault sauna " +
  "saunt saury sauts saved saver saves savey savin savor savoy savvy sawah sawed sawer saxes sayed sayer sayid " +
  "sayne sayon sayst sazes scabs scads scaff scags scail scala scald scale scall scalp scaly scamp scams scand " +
  "scans scant scapa scape scapi scare scarf scarp scars scart scary scath scats scatt scaud scaup scaur scaws " +
  "sceat scena scend scene scent schav schmo schul schwa scifi scind scion sclim scody scoff scogs scold scone " +
  "scoog scoop scoot scopa scope scops score scorn scots scott scoug scoup scour scout scowl scows scrab scrae " +
  "scrag scram scran scrap scrat scraw scray scree screw scrim scrip scrod scrog scrow scrub scrum scuba scudi " +
  "scudo scuds scuff scugs sculk scull sculp scult scums scups scurf scurs scuse scuta scute scuts scuzz scyes " +
  "seals seame seams seamy seans sears sease seats seaze sebum secco sechs sects sedan seder sedes sedge sedgy " +
  "sedum seeds seedy seeks seeld seels seely seems seeps seepy seers seese segar segni segno segol segos segue " +
  "seifs seils seine seirs seise seism seity seize sekos sekts selah seles selfs selku sells selva semee semen " +
  "semes semie semis senas sends senes senex sengi senna senor sensa sense sensi sente senti sents senvy senza " +
  "sepad sepal sepia sepic sepoy sepul seqed seqes seque serac serai seral seras serbs sered serer seres serfs " +
  "serge seric serif serin serks seron serow serra serre serrs serry serum serve servo sesey sessa setae setal " +
  "seton setts setup seven sever sewan sewar sewed sewen sewer sewin sexed sexer sexes sexto sexts seyen shack " +
  "shade shads shady shaft shags shahs shake shako shaks shaky shale shall shalm shalt shaly shama shame shams " +
  "shana shand shank shans shape shaps shard share shark sharn sharp shash shaul shave shawl shawm shawn shaws " +
  "shaya shays sheaf sheal shear sheas sheds sheel sheen sheep sheer sheet sheik sheil shelf shell shend shent " +
  "sheol sherd shere sheva shewn shews shiai shied shiel shier shies shift shill shims shine shins shiny ships " +
  "shipt shire shirk shirr shirs shirt shish shiso shist shite shits shiur shiva shive shivs shlep shoal shoat " +
  "shock shoed shoer shoes shogi shogs shoji shojo shola shone shook shool shoon shoos shoot shope shops shore " +
  "shorl shorn short shote shots shott shout shove shown shows showy shoyu shred shrew shris shrow shrub shrug " +
  "shtum shtup shuba shuck shule shuln shuls shune shunt shura shush shute shuts shwas shyer shyly sials sibbs " +
  "sibyl sices sicht sicko sicks sidas sided sider sides sidha sidhe sidle siege sield siens sient sieth sieur " +
  "sieve sifts sighs sight sigil sigla sigma signa signs sijos sikas siker sikes silds siled silen siler siles " +
  "silex silks silky sills silly silos silts silty silva simar simas simba simis simns simos simps simul since " +
  "sinds sined sines sinew singe sings sinhs sinks sinky sinus siped sipes sippy sired siree siren sires sirih " +
  "siris sirra sirup sisal sises sissy sists sitar sited sites sithe sitka situp situs siver sixer sixes sixmo " +
  "sixte sixth sixty sizar sized sizel sizer sizes skags skail skald skank skarn skart skate skats skatt skaws " +
  "skean skear skeds skeed skeef skeen skeer skees skeet skegg skegs skein skelf skell skelm skelp skene skens " +
  "skeos skeps skere skerm skers skets skews skids skied skier skies skiey skiff skill skimo skimp skims skink " +
  "skins skint skios skips skirl skirr skirt skite skits skive skivy sklim skoal skods skoff skogs skols skool " +
  "skort skosh skran skrik skuas skugs skulk skull skunk skyed skyer skyey skyfs skyre skyrs slabs slack slade " +
  "slaes slags slaid slain slake slams slane slang slank slant slaps slart slash slate slats slaty slave slaws " +
  "slays sleds sleek sleep sleer sleet slept slews sleys slice slick slide slier slily slime slims slimy sling " +
  "slink slipe slips slipt slish slits slive sloan slobs sloid slojd sloom sloop sloot slope slops slosh sloth " +
  "slots slove slows sloyd slubb slubs slued slues sluff slugs sluit slump slums slung slunk slurb slurp slurs " +
  "slush sluts slyer slype smaak smack smaik small smalm smalt smarm smart smash smaze smear smeek smees smegs " +
  "smell smelt smerk smews smile smirk smirr smirs smite smith smits smock smogs smoke smoko smoky smolt smoor " +
  "smoot smore smote smous smout smowt smugs smurs smush snabs snack snafu snags snail snake snaky snape snaps " +
  "snapy snare snarf snark snarl snars snary snash snath snaws sneak sneap snebs sneck sneds sneer snell snept " +
  "snibs snick snide snies sniff snift snigs snipe snips snipy snirt snits snobs snock snods snoek snoep snogs " +
  "snoke snood snook snool snoop snoot snore snort snots snout snowk snows snowy snubs snuck snuff snugs snush " +
  "snyes soaks soaps soapy soare soars soave sobas sobby sober socas soces socko socks socle sodas soddy sodic " +
  "sodom sofar sofas softa softy soger soggy sohur soils soily sojas sojus sokah soken sokes sokol solah solan " +
  "solar solas solde soldi soldo solds soled solei soler soles solfa solid solns solon solos solum solus solve " +
  "somas sonar sonce sonde sones songs sonic sonly sonne sonny sonse sonsy sooey sooks sooky soole sools sooms " +
  "soops soote sooth soots sooty sophs sophy sopor soppy soral soras sorbo sorbs sorda sordo sords sored soree " +
  "sorel sorer sores sorex sorgo sorns sorra sorry sorta sorts sorus soths sotol sough souks souls soums sound " +
  "soups soupy sourd sours souse south souts sowar sowce sowed sowel sower sowff sowfs sowle sowls sownd sowne " +
  "sowps sowse sowth soyas soyle soyuz sozin space spade spaes spags spahi spail spain spait spake spald spale " +
  "spall spalt spams spane spang spank spans spard spare spark spars spart spasm spate spats spaul spawl spawn " +
  "spays spazz speak speal spean spear speat speck specs spect speed speel speer speil speir speks speld spell " +
  "spelt spend spent speos sperm spets spewy spial spica spice spick spics spicy spide spied spiel spier spies " +
  "spife spiff spifs spike spiks spiky spile spill spilt spims spina spine spink spins spiny spire spirt spiry " +
  "spise spite spits spivs splat splay splen split splog spods spoil spoke spoof spook spool spoom spoon spoor " +
  "spoot spore spork sport sposh spots spout sprad sprag sprat spray spred spree sprew sprig sprit sprod sprog " +
  "sprue sprug spuds spued spuer spues spugs spule spuls spume spumy spung spunk spurn spurs spurt sputa spyal " +
  "spyre squab squad squat squaw squeg squib squid squiz stabs stack stade staff stage stags stagy staid staig " +
  "stain stair stake stale stalk stall stamp stand stane stang stank staph stare stark starn starr stars start " +
  "stash state stats staun stave staws stays stead steak steal steam stean stear stede steed steek steel steem " +
  "steen steep steer steil stein stela stele stell stema stems stend steno stens stent steps stere stern stets " +
  "stews stewy steyl steys stich stick stied sties stiff stilb stile still stilt stime stims stimy sting stink " +
  "stint stipa stipe stire stirk stirp stirs stive stoae stoai stoas stoat stobs stock stoep stoff stogy stoic " +
  "stoit stoke stole stoln stoma stomp stond stone stong stonk stonn stony stood stook stool stoop stoor stope " +
  "stops stopt store stork storm story stoss stots stott stoun stoup stour stout stove stown stowp stows strad " +
  "strae strag strak strap straw stray stree strep stria strid strim strip strob strod strop strow stroy strum " +
  "strut stubs stuck studs study stuff stull stulm stump stums stung stunk stunt stupa stupe sturt styed styes " +
  "styin styli stylo styme styre styte suave subah subas subby suber subha sucks sucky sucre sudds sudor sudsy " +
  "suede suent suers suety sugan sugar sughs suids suing suint suite suits sukes sukha sukuk sulci sulfa sulfo " +
  "sulks sulky sully sumac sumis summa sumos sumps sunna sunns sunny sunup super supes supra surah sural suras " +
  "surat surds sured surer sures surfs surfy surge surgy surly surra sused suses sushi susus sutor sutra sutta " +
  "swabs swack swads swage swags swail swain swale swaly swamp swamy swang swank swans swaps swapt sward sware " +
  "swarf swarm swart swash swath swats sways sweal swear sweat sweed sweel sweep sweer sweet sweir swell swelt " +
  "swept swerf sweys swies swift swigs swile swill swims swine swing swink swipe swire swirl swish swiss swith " +
  "swits swive swizz swobs swole swoln swoon swoop swops swopt sword swore sworn swots swoun swung swure sybbe " +
  "sybil sybow sycee syces sycon syens syker sykes sylis sylph sylva symar synch syncs synds syned synes synod " +
  "syped sypes syphs syrah syren syrup sysop sythe syver taals taata taber tabes tabid tabis tabla table taboo " +
  "tabor tabun tabus tacan taces tacet tache tacho tachs tacit tacka tacks tacky tacos tacts taels taffy tafia " +
  "taggy tagma tahas tahrs taiga taigs tails tains taint taira taish taits tajes takas taken taker takes takhi " +
  "takin takis takky talak talaq talar talas talcs talcy talea taler tales talie talik talks talky talls tally " +
  "talma talon talpa talus tamal tamar tamau tames tamin tamis tammy tamps tanas tanga tangi tango tangs tangy " +
  "tanhs tanka tanks tanky tanna tansy tanti tanto tapas taped taper tapes tapet tapir tapis tappa tapus taras " +
  "tardo tardy tared tares targa targe tarns taroc tarok taros tarot tarps tarre tarry tarsi tarts tarty tasar " +
  "tased taser tases tasks taste tasty tatar tater tates taths tatie tatou tatts tatty tatus taube tauld taunt " +
  "tauon taupe tauts tavah tavas taver tawai tawas tawed tawer tawie tawny tawse tawts taxed taxer taxes taxis " +
  "taxol taxon taxor taxus tayra tazza tazze tchic teach teade teads teaed teaks teals teams tears teary tease " +
  "teats teaze techs techy tecta teddy tedge teels teems teend teene teens teeny teers teest teeth teffs tefts " +
  "tegua tegus tehrs teils teind teins telae telco teled teles telex telia telic tells telly teloi telos temed " +
  "temes tempi tempo temps tempt temse tench tends tendu tenet tenge tenia tenne tenno tenny tenon tenor tense " +
  "tente tenth tents tenty tepal tepas tepee tepid terai teras terce terek teres terga terms terne terns terra " +
  "terry terse terts tesla testa teste tests testy tetes teths tetra tetri teuch teugh tevet tewed tewel tewit " +
  "texas texts thack thagi thaim thale thali thana thane thang thank thans tharm thars thats thaws thawy thebe " +
  "theca theed theek theer theft thegn theic thein their theme thens theow there therm these thesp theta thete " +
  "thews thewy thick thief thigh thilk thill thine thing think thins thiol third thirl thong thorn thoro thorp " +
  "those thous thowl thrae thraw three threw thrid thrip throb throe throw thrum thuds thugs thuja thumb thump " +
  "thunk thurl thuya thwap thyme thymi thymy tians tiara tiars tibia tical ticca ticed tices ticks ticky tidal " +
  "tided tides tiers tiffs tifos tifts tiger tiges tight tigon tikas tiked tikes tikis tikka tikky tilak tilde " +
  "tiled tiler tiles tills tilly tilth tilts tilty timbo timed timer times timid timon timps tinas tinct tinda " +
  "tinds tinea tined tines tinge tings tinks tinny tinst tints tinty tippy tipsy tipus tired tires tirls tiros " +
  "tirrs titan titch titen titer tithe titis title titre titty tityl tizes tizzy toads toady toast toaze tobas " +
  "toced tocks tocky tocos today todde toddy toeas toffs toffy tofts tofus togae togas toged toges toght toile " +
  "toils toing toise toits tokay toked token toker tokes tokos tolan tolar tolas toldo toled toles tolls tolly " +
  "tolts tolus tolyl toman tombs tomes tomia tommy tomos tonal tondi tondo toned toner tones toney tonga tongs " +
  "tonic tonka tonks tonne tonto tonus tools tooms toons tooth toots topas topaz toped topee topek toper topes " +
  "tophe tophi tophs topic topis topoi topos toppy toque torah toran toras torch torcs tores toric torii toros " +
  "torot torrs torse torsi torsk torso torta torte torts torus tosas tosed toses tossa total toted totem toter " +
  "totes toths totty touch tough tould touns toupe tours touse tousy touts touze touzy tovah tovas towed towel " +
  "tower towie towns towny towse towsy towts towze towzy toxes toxic toxin toyed toyer toyon toyos tozed tozes " +
  "tozie trabs trace track tract trade trads tragi traik trail train trais trait tramp trams trank tranq trans " +
  "trant traps trapt trash trass trats tratt trave trawl trays tread treas treat treck treed treen trees treey " +
  "trefa treif treks trema trend tress trest trets trews treyf treys triac triad trial tribe trice trick tride " +
  "tried trier tries triff trigo trigs trike trild trill trims trine trins triol triop trios tripe trips tripy " +
  "trist trite troad troak troat trock trode trods trogs trois troke troll tromp trona tronc trone tronk trons " +
  "troop trooz trope troth trots trout trove trows troys truce truck truer trues trugo trugs trull truly trump " +
  "trunk truss trust truth tryer tryke tryma tryps tryst tsade tsadi tsars tsked tsuba tsubo tuans tuart tuath " +
  "tubae tubal tubar tubas tubbs tubby tubed tuber tubes tucks tufas tuffe tuffs tufts tufty tugra tuile tuina " +
  "tuism tukky tular tules tulip tulle tulpa tulsi tumid tummy tumor tumps tumpy tunas tunds tuned tuner tunes " +
  "tungs tunic tunny tupek tupik tuple tuque turbo turds turfs turfy turks turme turms turns turnt turps turrs " +
  "turul tusks tusky tutee tutor tutti tutty tutus tuxes tuyer twaes twain twals twang twank twats tways tweak " +
  "tweat tweed tweel tween tweep tweer tweet twerk twerp twice twick twier twigs twill twilt twine twink twins " +
  "twiny twire twirl twirp twist twite twits twixt twoer twoss twyer tyees tyers tying tyiyn tykes tyler types " +
  "typey typic typos typps typto tyran tyred tyres tyros tythe tzars ubacs udals udder udons ugali uglis ukase " +
  "ulama ulans ulcer ulema ulmin ulnad ulnae ulnar ulnas ulpan ultra ulvas ulyie ulzie umami umbel umber umble " +
  "umbos umbra umbre umiac umiak umiaq ummah ummas ummed umped umphs umpie umpty umrah umras unais unapt unarm " +
  "unary unaus unbag unban unbar unbed unbid unbox uncap unces uncia uncle uncos uncoy uncus uncut undam undee " +
  "under undid undue undug unfed unfit unfix ungag ungod ungot ungum unhat unhip unica unify union unite units " +
  "unity unjam unked unkey unkid unlaw unlay unled unlet unlid unlit unman unmen unmet unmew unmix unown unpay " +
  "unpeg unpen unpin unray unred unrid unrig unrip unsay unsee unset unsew unsex unsod untax untie until untin " +
  "unwed unwet unwit unwon unzip upbow upbye updos updry upend upjet uplay upled uplit upped upper uprun upsee " +
  "upset uptak uptie upway uraei urali uraos urari urase urate urban urbex urbia urded urdee urdes ureal ureas " +
  "uredo ureic ureid urena urent urged urger urges urial urine urite urman urnal urned urped ursae ursid usage " +
  "usard users usher using usnea usque usual usure usurp usury uteri utero utile utter uveal uveas uvula vacas " +
  "vacua vaded vades vagal vague vagus vails vairs vairy vakas vakil vales valet valid valis valor valse value " +
  "valve vamps vampy vanda vaned vanes vangs vants vaped vaper vapes vapid vapor varan varas varda vardy varec " +
  "vares varia varix varna varus varve vases vasts vasty vatic vatus vauch vault vaunt vaute vauts vawte veale " +
  "veals vealy veena veeps veers veery vegan vegas veges vegie vegos vehme veils veily veins veiny velar velds " +
  "veldt veles vells velum venae venal vends venge venin venom vents venue venus verbs verde verge verra verre " +
  "verry verse verso verst verts vertu verve vespa vesta vests vetch vexed vexer vexes vexil vezir vials viand " +
  "vibes vibex vibey vicar viced vices vichy video viers views viewy vifda vigas vigia vigil vigor vilde villa " +
  "villi vimen vinal vinas vinca vined viner vines vinew vinic vinos vinyl viola viols viper viral vired vireo " +
  "vires virga virge virid virtu virus visas vised vises visie visit visne vison visor vista visto vitae vital " +
  "vitas vitex vitro vitta vivas vivat vivda viver vives vivid vixen vizir vizor vleis vlies vlogs voars vobla " +
  "vocab vocal voced voces vodka vodou vodun voema vogie vogue voice voids voila voile voled voles volet volks " +
  "volta volte volti volts volva vomer vomit voter vouch vouge voulu vowed vowel vower voxel vozhd vraic vrils " +
  "vroom vrots vroum vrouw vrows vughs vughy vulgo vulns vulva vutty waacs wacke wacko wacks wacky wadds waddy " +
  "waded wader wades wadge wadis wadts wafer waffs wafts waged wager wages wagga wagon wahoo waide waifs wails " +
  "wains wairs waist waite waits waive wakas waked waken waker wakes wakfs waldo walds waler wales walie walis " +
  "walks walla walls wally waltz wamed wames wamus wands waned wanes waney wangs wanks wanky wanle wanly wanna " +
  "wants wanze waqfs warbs warby warde wards wared wares warez warks warms warns warps warre warst warts warty " +
  "wases washy wasms wasps waspy waste wasts watap watch water watts wauff waugh wauks waukt wauls waurs waved " +
  "waver waves wavey wawas wawes wawls waxed waxen waxer waxes wayed wazir wazoo weald weals weamb weans wears " +
  "weary weave webby weber wecht wedel wedge wedgy weeds weedy weeke weeks weels weems weens weeny weeps weepy " +
  "weest weete weets weeze wefte wefts weids weigh weils weird weirs weise weize wekas welch welds welke welks " +
  "welkt wells welly welsh welts wembs wench wends wenge wenny wents wered weros wersh wests wetas wetly wexed " +
  "wexes whack whale whame whamo whams whang whaps whare wharf whata whats whaup whaur wheal whear wheat wheel " +
  "wheen wheep wheft whelk whelm whelp whens where whets whews wheys which whids whies whiff whift whigs while " +
  "whilk whims whine whins whiny whios whips whipt whirl whirr whirs whish whisk whiss whist white whits whity " +
  "whizz whole whomp whoof whoop whops whore whorl whort whose whoso whows whump whups whyda wicca wicks wicky " +
  "widdy widen wider wides widow width wield wifed wifes wifey wifie wifty wigan wigga wiggy wight wikis wilco " +
  "wilds wiled wiles wilga wilis wilja willy wilts wimps wimpy wince winch winds windy wined wines winey winge " +
  "wings wingy winks winna winns winos winze wiped wiper wipes wired wirer wires wirra wirri wised wiser wises " +
  "wisha wisht wisps wispy wists witan witch wited wites withe withs withy witty wived wiver wives wizen wizes " +
  "woads woald wocks wodge woful wojus woken woker wokka wolds wolfs wolly wolve woman wombs womby women wonga " +
  "wongi wonks wonky wonts woods woody wooed wooer woofs woofy woold wools wooly woons woops woopy woose woosh " +
  "woote woots woozy words wordy works world worms wormy worns worry worse worst worth worts would wound woven " +
  "wowed wowee woxen wrack wrang wraps wrapt wrast wrate wrath wrawl wreak wreck wrens wrest wrick wride wried " +
  "wrier wries wring wrist write writs wroke wrong wroot wrote wroth wrung wryer wryly wukas wulls wurst wuses " +
  "wushu wussy wuxia wyled wyles wynds wynns wyted wytes xebec xenia xenic xenon xeric xerox xerus xoana xonas " +
  "xrays xviii xylan xylem xylic xylol xylyl xysti xysts yaars yabas yabby yacca yacht yacka yacks yaffs yager " +
  "yagis yahoo yaird yakka yakow yales yamen yampy yamun yangs yanks yapok yapon yapps yappy yarak yarco yards " +
  "yarer yarns yarrs yarta yarto yates yauds yauld yaups yawed yawey yawls yawns yawny yawps ybore yclad ycled " +
  "ycond ydrad ydred yeads yeahs yealm yeans yeard yearn years yeast yecch yechs yechy yedes yeeds yeesh yeggs " +
  "yelks yells yelms yelps yelts yenta yente yerba yerds yerin yerks yeses yesks yests yeuks yeuky yeven yeves " +
  "yewen yexed yexes yfere yield yiked yikes yills yince yipes yippy yirds yirks yirrs yirth yites yitie ylems " +
  "ylike ylkes ymolt ympes yobbo yobby yocks yodel yodhs yodle yogas yogee yoghs yogic yogin yogis yoick yojan " +
  "yoked yokel yoker yokes yolks yolky yomim yomps yonic yonis yonks yoofs yoops yores yorks yorps youks young " +
  "yourn yours youse youth yowes yowie yowls yowza ypres yrapt yrent yrivd yrneh ysame ytost yuans yucas yucca " +
  "yucch yucko yucks yucky yufts yugas yukao yuked yukes yukky yukos yulan yules yummo yummy yumps yupon yuppy " +
  "yurta yurts yutes yuzus zabra zacks zaida zaidy zaire zakat zaman zambo zamia zanja zante zanza zappy zarfs " +
  "zaris zatis zaxes zayde zazen zeals zebec zebra zebub zebus zedas zeins zendo zerda zerks zeros zests zesty " +
  "zetas zexes zezes zhomo zibet ziffs zigan zilas zilch zilla zills zimbi zinco zincs zincy zineb zines zings " +
  "zingy zinke zinky zippo zippy ziram zitis zizel zizit zlote zloty zoaea zoeae zoeal zoeas zoism zoist zokor " +
  "zolas zombi zonae zonal zoned zoner zones zonks zooea zooey zooid zooks zooms zoons zooty zoppa zoppo zoril " +
  "zoris zorro zorse zouks zowee zowie zulus zupan zupas zuppa zurfs zuzim zygal zygon zymes zymic";

/** Allowed-guess dictionary (superset of answers). O(1) membership via Set. */
export const WORD_GRID_VALID: ReadonlySet<string> = new Set(
  WORD_GRID_VALID_PACKED.split(/\s+/).filter(Boolean),
);
