const CONNECTIONS_PUZZLES = [
  // ── Puzzle 1 ──
  {
    groups: [
      { category: 'Sorting Algorithms', words: ['Quick Sort', 'Merge Sort', 'Heap Sort', 'Bubble Sort'], color: '#f8d74e' },
      { category: 'HTTP Methods', words: ['GET', 'POST', 'PUT', 'DELETE'], color: '#7ed66e' },
      { category: 'Version Control Actions', words: ['Commit', 'Branch', 'Merge', 'Rebase'], color: '#6eb4f8' },
      { category: 'Things That Have Stacks', words: ['Pancake', 'Overflow', 'Trace', 'Frame'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 2 ──
  {
    groups: [
      { category: 'Data Structures', words: ['Array', 'Queue', 'Deque', 'Heap'], color: '#f8d74e' },
      { category: 'CSS Display Values', words: ['Block', 'Flex', 'Grid', 'Inline'], color: '#7ed66e' },
      { category: 'Linux Commands', words: ['grep', 'chmod', 'curl', 'sudo'], color: '#6eb4f8' },
      { category: '___ Tree', words: ['Binary', 'Decision', 'Syntax', 'Spanning'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 3 ──
  {
    groups: [
      { category: 'JavaScript Frameworks', words: ['React', 'Vue', 'Angular', 'Svelte'], color: '#f8d74e' },
      { category: 'Database Types', words: ['SQL', 'Mongo', 'Redis', 'Neo4j'], color: '#7ed66e' },
      { category: 'Design Patterns', words: ['Singleton', 'Factory', 'Observer', 'Adapter'], color: '#6eb4f8' },
      { category: 'Words Before "Script"', words: ['Java', 'Type', 'Action', 'ECMA'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 4 ──
  {
    groups: [
      { category: 'Python Keywords', words: ['yield', 'lambda', 'async', 'await'], color: '#f8d74e' },
      { category: 'Network Protocols', words: ['TCP', 'UDP', 'HTTP', 'FTP'], color: '#7ed66e' },
      { category: 'Graph Algorithms', words: ['Dijkstra', 'Prim', 'Kruskal', 'Floyd'], color: '#6eb4f8' },
      { category: 'Things That Can Be "Dead"', words: ['Lock', 'Code', 'Letter', 'End'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 5 ──
  {
    groups: [
      { category: 'Big-O Complexities', words: ['O(1)', 'O(n)', 'O(log n)', 'O(n²)'], color: '#f8d74e' },
      { category: 'Cloud Providers', words: ['AWS', 'Azure', 'GCP', 'Vercel'], color: '#7ed66e' },
      { category: 'Compiler Phases', words: ['Lexing', 'Parsing', 'Linking', 'Codegen'], color: '#6eb4f8' },
      { category: '___ Injection', words: ['SQL', 'Code', 'Dependency', 'Fault'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 6 ──
  {
    groups: [
      { category: 'Boolean Operators', words: ['AND', 'OR', 'NOT', 'XOR'], color: '#f8d74e' },
      { category: 'Testing Types', words: ['Unit', 'Integration', 'Regression', 'Smoke'], color: '#7ed66e' },
      { category: 'Functional Concepts', words: ['Monad', 'Functor', 'Curry', 'Closure'], color: '#6eb4f8' },
      { category: 'Famous Vulnerabilities', words: ['Y2K', 'Heartbleed', 'Log4Shell', 'Shellshock'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 7 ──
  {
    groups: [
      { category: 'Git Commands', words: ['clone', 'fetch', 'stash', 'cherry-pick'], color: '#f8d74e' },
      { category: 'Memory Types', words: ['Stack', 'Heap', 'Cache', 'Register'], color: '#7ed66e' },
      { category: 'Cryptographic Algorithms', words: ['AES', 'RSA', 'SHA', 'MD5'], color: '#6eb4f8' },
      { category: 'Words That Follow "Hash"', words: ['Map', 'Table', 'Set', 'Code'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 8 ──
  {
    groups: [
      { category: 'Container Tools', words: ['Docker', 'Kubernetes', 'Podman', 'Helm'], color: '#f8d74e' },
      { category: 'Number Systems', words: ['Binary', 'Octal', 'Decimal', 'Hex'], color: '#7ed66e' },
      { category: 'Machine Learning Models', words: ['CNN', 'RNN', 'GAN', 'GPT'], color: '#6eb4f8' },
      { category: 'Things That Can "Overflow"', words: ['Buffer', 'Stack', 'Integer', 'Heap'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 9 ──
  {
    groups: [
      { category: 'CSS Properties', words: ['margin', 'padding', 'opacity', 'z-index'], color: '#f8d74e' },
      { category: 'SOLID Principles (Initials)', words: ['Single', 'Open', 'Liskov', 'Interface'], color: '#7ed66e' },
      { category: 'Shell Types', words: ['Bash', 'Zsh', 'Fish', 'PowerShell'], color: '#6eb4f8' },
      { category: '___ Code', words: ['Source', 'Byte', 'Machine', 'Status'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 10 ──
  {
    groups: [
      { category: 'JavaScript Array Methods', words: ['map', 'filter', 'reduce', 'forEach'], color: '#f8d74e' },
      { category: 'API Architectures', words: ['REST', 'GraphQL', 'gRPC', 'SOAP'], color: '#7ed66e' },
      { category: 'Regex Characters', words: ['Dot', 'Star', 'Caret', 'Dollar'], color: '#6eb4f8' },
      { category: 'Things That Have "Nodes"', words: ['DOM', 'Linked List', 'Cluster', 'AST'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 11 ──
  {
    groups: [
      { category: 'Programming Paradigms', words: ['OOP', 'Functional', 'Declarative', 'Imperative'], color: '#f8d74e' },
      { category: 'Package Managers', words: ['npm', 'pip', 'cargo', 'brew'], color: '#7ed66e' },
      { category: 'Concurrency Primitives', words: ['Mutex', 'Semaphore', 'Barrier', 'Channel'], color: '#6eb4f8' },
      { category: 'Things With "Ports"', words: ['Serial', 'Firewall', 'Docker', 'Server'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 12 ──
  {
    groups: [
      { category: 'Rust Concepts', words: ['Borrow', 'Lifetime', 'Trait', 'Crate'], color: '#f8d74e' },
      { category: 'HTTP Status Codes', words: ['200', '301', '404', '500'], color: '#7ed66e' },
      { category: 'Search Algorithms', words: ['Binary', 'Linear', 'BFS', 'DFS'], color: '#6eb4f8' },
      { category: '___ Table', words: ['Hash', 'Routing', 'Symbol', 'Pivot'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 13 ──
  {
    groups: [
      { category: 'CI/CD Tools', words: ['Jenkins', 'GitHub Actions', 'CircleCI', 'Travis'], color: '#f8d74e' },
      { category: 'Type System Concepts', words: ['Generic', 'Covariant', 'Nullable', 'Union'], color: '#7ed66e' },
      { category: 'Recursion Related', words: ['Base Case', 'Tail Call', 'Memoization', 'Stack Frame'], color: '#6eb4f8' },
      { category: 'Things That Are "Dynamic"', words: ['Typing', 'Programming', 'Dispatch', 'Memory'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 14 ──
  {
    groups: [
      { category: 'Color Formats', words: ['RGB', 'HSL', 'HEX', 'CMYK'], color: '#f8d74e' },
      { category: 'SQL Clauses', words: ['SELECT', 'WHERE', 'JOIN', 'GROUP BY'], color: '#7ed66e' },
      { category: 'Agile Ceremonies', words: ['Sprint', 'Standup', 'Retro', 'Planning'], color: '#6eb4f8' },
      { category: 'Double Meaning: CS & Food', words: ['Cookie', 'Pickle', 'Slice', 'Fork'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 15 ──
  {
    groups: [
      { category: 'Text Editors / IDEs', words: ['Vim', 'Emacs', 'VSCode', 'Nano'], color: '#f8d74e' },
      { category: 'AWS Services', words: ['Lambda', 'S3', 'EC2', 'DynamoDB'], color: '#7ed66e' },
      { category: 'Error Handling', words: ['Try', 'Catch', 'Throw', 'Finally'], color: '#6eb4f8' },
      { category: 'Things That "Compile"', words: ['Sass', 'TypeScript', 'Regex', 'Shader'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 16 ──
  {
    groups: [
      { category: 'Web Storage', words: ['Cookie', 'Session', 'Local', 'IndexedDB'], color: '#f8d74e' },
      { category: 'Software Licenses', words: ['MIT', 'GPL', 'Apache', 'BSD'], color: '#7ed66e' },
      { category: 'OOP Pillars', words: ['Encapsulation', 'Inheritance', 'Polymorphism', 'Abstraction'], color: '#6eb4f8' },
      { category: '___ Pool', words: ['Thread', 'Connection', 'Memory', 'Object'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 17 ──
  {
    groups: [
      { category: 'Frontend Build Tools', words: ['Webpack', 'Vite', 'Rollup', 'esbuild'], color: '#f8d74e' },
      { category: 'DNS Record Types', words: ['A', 'CNAME', 'MX', 'TXT'], color: '#7ed66e' },
      { category: 'Automata Types', words: ['DFA', 'NFA', 'PDA', 'Turing'], color: '#6eb4f8' },
      { category: 'Things With "Keys"', words: ['API', 'Primary', 'Foreign', 'SSH'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 18 ──
  {
    groups: [
      { category: 'React Hooks', words: ['useState', 'useEffect', 'useRef', 'useMemo'], color: '#f8d74e' },
      { category: 'Document Formats', words: ['HTML', 'XML', 'Markdown', 'LaTeX'], color: '#7ed66e' },
      { category: 'Networking Layers', words: ['Physical', 'Transport', 'Network', 'Application'], color: '#6eb4f8' },
      { category: 'Things That Can "Leak"', words: ['Memory', 'Abstraction', 'Data', 'Resource'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 19 ──
  {
    groups: [
      { category: 'Python Packages', words: ['NumPy', 'Pandas', 'Flask', 'Django'], color: '#f8d74e' },
      { category: 'Bitwise Operations', words: ['Shift', 'Mask', 'Toggle', 'Rotate'], color: '#7ed66e' },
      { category: 'Process States', words: ['Ready', 'Running', 'Blocked', 'Zombie'], color: '#6eb4f8' },
      { category: 'Things That "Branch"', words: ['Git', 'CPU', 'Tree', 'Pipeline'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 20 ──
  {
    groups: [
      { category: 'SQL Aggregate Functions', words: ['COUNT', 'SUM', 'AVG', 'MAX'], color: '#f8d74e' },
      { category: 'Auth Methods', words: ['OAuth', 'JWT', 'SAML', 'API Key'], color: '#7ed66e' },
      { category: 'Things You "Deploy"', words: ['Container', 'Lambda', 'Service', 'Build'], color: '#6eb4f8' },
      { category: 'Complexity Classes', words: ['P', 'NP', 'NP-Hard', 'PSPACE'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 21 ──
  {
    groups: [
      { category: 'Image Formats', words: ['PNG', 'JPEG', 'SVG', 'WebP'], color: '#f8d74e' },
      { category: 'OS Schedulers', words: ['FIFO', 'Round Robin', 'SJF', 'Priority'], color: '#7ed66e' },
      { category: 'Haskell Concepts', words: ['Monad', 'Functor', 'Applicative', 'Typeclass'], color: '#6eb4f8' },
      { category: '___ Driven Development', words: ['Test', 'Behavior', 'Domain', 'Event'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 22 ──
  {
    groups: [
      { category: 'CSS Units', words: ['px', 'rem', 'em', 'vh'], color: '#f8d74e' },
      { category: 'Caching Strategies', words: ['LRU', 'LFU', 'MRU', 'Write-Back'], color: '#7ed66e' },
      { category: 'Famous CS Figures', words: ['Turing', 'Knuth', 'Dijkstra', 'Hopper'], color: '#6eb4f8' },
      { category: 'Things With a "Root"', words: ['DOM', 'File System', 'Binary Tree', 'DNS'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 23 ──
  {
    groups: [
      { category: 'Docker Commands', words: ['build', 'run', 'push', 'compose'], color: '#f8d74e' },
      { category: 'TypeScript Utility Types', words: ['Partial', 'Readonly', 'Pick', 'Omit'], color: '#7ed66e' },
      { category: 'Pointer Concepts', words: ['Null', 'Dangling', 'Smart', 'Wild'], color: '#6eb4f8' },
      { category: 'Types of "Testing"', words: ['Fuzz', 'Load', 'Pen', 'A/B'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 24 ──
  {
    groups: [
      { category: 'JavaScript Primitives', words: ['string', 'number', 'boolean', 'symbol'], color: '#f8d74e' },
      { category: 'Kubernetes Objects', words: ['Pod', 'Service', 'Ingress', 'ConfigMap'], color: '#7ed66e' },
      { category: 'Sorting Properties', words: ['Stable', 'In-Place', 'Adaptive', 'Comparison'], color: '#6eb4f8' },
      { category: 'Things That Can Be "Lazy"', words: ['Loading', 'Evaluation', 'Initialization', 'Fetching'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 25 ──
  {
    groups: [
      { category: 'vim Commands', words: [':wq', 'dd', 'yy', ':q!'], color: '#f8d74e' },
      { category: 'CSS Selectors', words: ['Class', 'ID', 'Child', 'Sibling'], color: '#7ed66e' },
      { category: 'Garbage Collection', words: ['Mark', 'Sweep', 'Compact', 'Reference'], color: '#6eb4f8' },
      { category: '___ Graph', words: ['Call', 'Dependency', 'Control Flow', 'Scene'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 26 ──
  {
    groups: [
      { category: 'HTML Semantic Tags', words: ['header', 'article', 'section', 'footer'], color: '#f8d74e' },
      { category: 'Databases (NoSQL)', words: ['MongoDB', 'Cassandra', 'CouchDB', 'Firebase'], color: '#7ed66e' },
      { category: 'DevOps Practices', words: ['Canary', 'Blue-Green', 'Rolling', 'Shadow'], color: '#6eb4f8' },
      { category: 'Things That Are "Virtual"', words: ['Machine', 'DOM', 'Memory', 'Network'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 27 ──
  {
    groups: [
      { category: 'Keyboard Shortcuts (Actions)', words: ['Copy', 'Paste', 'Undo', 'Redo'], color: '#f8d74e' },
      { category: 'ACID Properties', words: ['Atomicity', 'Consistency', 'Isolation', 'Durability'], color: '#7ed66e' },
      { category: 'Networking Hardware', words: ['Router', 'Switch', 'Hub', 'Modem'], color: '#6eb4f8' },
      { category: '___ Pattern', words: ['Singleton', 'Strategy', 'Builder', 'Proxy'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 28 ──
  {
    groups: [
      { category: 'Web Performance Metrics', words: ['FCP', 'LCP', 'CLS', 'TTFB'], color: '#f8d74e' },
      { category: 'Programming Languages (Compiled)', words: ['C', 'Go', 'Rust', 'Swift'], color: '#7ed66e' },
      { category: 'File Permissions', words: ['Read', 'Write', 'Execute', 'Owner'], color: '#6eb4f8' },
      { category: 'Things That Can Be "Abstract"', words: ['Class', 'Type', 'Syntax', 'Factory'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 29 ──
  {
    groups: [
      { category: 'SQL JOINs', words: ['INNER', 'LEFT', 'RIGHT', 'CROSS'], color: '#f8d74e' },
      { category: 'Observability Pillars', words: ['Logs', 'Metrics', 'Traces', 'Alerts'], color: '#7ed66e' },
      { category: 'Pointer Arithmetic', words: ['Dereference', 'Address', 'Offset', 'Null'], color: '#6eb4f8' },
      { category: '___ Literal', words: ['String', 'Template', 'Object', 'Array'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 30 ──
  {
    groups: [
      { category: 'HTTP Headers', words: ['Content-Type', 'Authorization', 'Accept', 'Origin'], color: '#f8d74e' },
      { category: 'Data Serialization', words: ['JSON', 'Protobuf', 'Avro', 'MessagePack'], color: '#7ed66e' },
      { category: 'Creational Patterns', words: ['Builder', 'Prototype', 'Factory', 'Singleton'], color: '#6eb4f8' },
      { category: 'Things With "Threads"', words: ['CPU', 'Web Worker', 'Process', 'Pool'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 31 ──
  {
    groups: [
      { category: 'CSS Pseudo-classes', words: [':hover', ':focus', ':active', ':visited'], color: '#f8d74e' },
      { category: 'Message Queues', words: ['Kafka', 'RabbitMQ', 'SQS', 'Redis Pub/Sub'], color: '#7ed66e' },
      { category: 'CAP Theorem', words: ['Consistency', 'Availability', 'Partition', 'Tolerance'], color: '#6eb4f8' },
      { category: 'Things That "Resolve"', words: ['Promise', 'DNS', 'Conflict', 'Import'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 32 ──
  {
    groups: [
      { category: 'CLI Symbols', words: ['Pipe', 'Tilde', 'Ampersand', 'Semicolon'], color: '#f8d74e' },
      { category: 'ML Optimization', words: ['SGD', 'Adam', 'RMSProp', 'Adagrad'], color: '#7ed66e' },
      { category: 'Binary Tree Traversals', words: ['Inorder', 'Preorder', 'Postorder', 'Level'], color: '#6eb4f8' },
      { category: 'Double Meaning: CS & Music', words: ['Loop', 'Bridge', 'Stream', 'Track'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 33 ──
  {
    groups: [
      { category: 'Architectural Styles', words: ['Monolith', 'Microservice', 'Serverless', 'SOA'], color: '#f8d74e' },
      { category: 'CSS Animations', words: ['Transition', 'Keyframes', 'Transform', 'Translate'], color: '#7ed66e' },
      { category: 'Distributed Consensus', words: ['Raft', 'Paxos', 'PBFT', 'Zab'], color: '#6eb4f8' },
      { category: '___ Binding', words: ['Data', 'Late', 'Key', 'Port'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 34 ──
  {
    groups: [
      { category: 'Code Smells', words: ['God Class', 'Dead Code', 'Long Method', 'Shotgun Surgery'], color: '#f8d74e' },
      { category: 'Git Branch Strategies', words: ['Feature', 'Release', 'Hotfix', 'Trunk'], color: '#7ed66e' },
      { category: 'Proof Techniques', words: ['Induction', 'Contradiction', 'Reduction', 'Pigeonhole'], color: '#6eb4f8' },
      { category: 'Things You "Spin Up"', words: ['Server', 'Container', 'Instance', 'Thread'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 35 ──
  {
    groups: [
      { category: 'JavaScript Events', words: ['click', 'keydown', 'scroll', 'submit'], color: '#f8d74e' },
      { category: 'Memory Management', words: ['Malloc', 'Free', 'Alloc', 'Dealloc'], color: '#7ed66e' },
      { category: 'Functional Languages', words: ['Haskell', 'Erlang', 'Clojure', 'Elixir'], color: '#6eb4f8' },
      { category: 'Things That Are "Native"', words: ['React Native', 'Cloud Native', 'Kotlin Native', 'Web Native'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 36 ──
  {
    groups: [
      { category: 'Docker Concepts', words: ['Image', 'Volume', 'Layer', 'Registry'], color: '#f8d74e' },
      { category: 'Regex Quantifiers', words: ['Plus', 'Question', 'Star', 'Brace'], color: '#7ed66e' },
      { category: 'Security Attacks', words: ['XSS', 'CSRF', 'MITM', 'DDoS'], color: '#6eb4f8' },
      { category: 'Things That "Execute"', words: ['Query', 'Script', 'Command', 'Function'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 37 ──
  {
    groups: [
      { category: 'CSS Layout', words: ['Flexbox', 'Grid', 'Float', 'Position'], color: '#f8d74e' },
      { category: 'Testing Frameworks', words: ['Jest', 'Mocha', 'Cypress', 'Playwright'], color: '#7ed66e' },
      { category: 'Network Topologies', words: ['Star', 'Ring', 'Mesh', 'Bus'], color: '#6eb4f8' },
      { category: 'Things With a "Handshake"', words: ['TCP', 'TLS', 'WebSocket', 'OAuth'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 38 ──
  {
    groups: [
      { category: 'JavaScript Promise Methods', words: ['then', 'catch', 'all', 'race'], color: '#f8d74e' },
      { category: 'Encoding Schemes', words: ['UTF-8', 'ASCII', 'Base64', 'URL'], color: '#7ed66e' },
      { category: 'Compiler Optimizations', words: ['Inlining', 'Unrolling', 'Constant Fold', 'Dead Elim'], color: '#6eb4f8' },
      { category: 'Things That "Listen"', words: ['Socket', 'EventEmitter', 'Port', 'Observer'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 39 ──
  {
    groups: [
      { category: 'Version Identifiers', words: ['Major', 'Minor', 'Patch', 'Build'], color: '#f8d74e' },
      { category: 'GraphQL Concepts', words: ['Query', 'Mutation', 'Subscription', 'Resolver'], color: '#7ed66e' },
      { category: 'CPU Architecture', words: ['ALU', 'Pipeline', 'Cache', 'Register'], color: '#6eb4f8' },
      { category: 'Words Before "Base"', words: ['Data', 'Code', 'Fire', 'Knowledge'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 40 ──
  {
    groups: [
      { category: 'Data Viz Libraries', words: ['D3', 'Chart.js', 'Plotly', 'Recharts'], color: '#f8d74e' },
      { category: 'Load Balancing Algorithms', words: ['Round Robin', 'Least Conn', 'IP Hash', 'Random'], color: '#7ed66e' },
      { category: 'Type Theory', words: ['Variance', 'Coercion', 'Erasure', 'Inference'], color: '#6eb4f8' },
      { category: 'Things That "Migrate"', words: ['Database', 'Schema', 'Cloud', 'Container'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 41 ──
  {
    groups: [
      { category: 'JavaScript Loops', words: ['for', 'while', 'do...while', 'for...of'], color: '#f8d74e' },
      { category: 'Monitoring Tools', words: ['Grafana', 'Prometheus', 'Datadog', 'Sentry'], color: '#7ed66e' },
      { category: 'Linked List Types', words: ['Singly', 'Doubly', 'Circular', 'Skip'], color: '#6eb4f8' },
      { category: '___ Handler', words: ['Event', 'Error', 'Signal', 'Request'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 42 ──
  {
    groups: [
      { category: 'TypeScript Decorators', words: ['Component', 'Injectable', 'Input', 'Output'], color: '#f8d74e' },
      { category: 'Linux File System', words: ['/etc', '/var', '/home', '/tmp'], color: '#7ed66e' },
      { category: 'Heap Variants', words: ['Min-Heap', 'Max-Heap', 'Fibonacci', 'Binomial'], color: '#6eb4f8' },
      { category: 'Things That "Dispatch"', words: ['Action', 'Event', 'Signal', 'Worker'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 43 ──
  {
    groups: [
      { category: 'CSS Box Model', words: ['Content', 'Padding', 'Border', 'Margin'], color: '#f8d74e' },
      { category: 'IaC Tools', words: ['Terraform', 'Ansible', 'Pulumi', 'CloudFormation'], color: '#7ed66e' },
      { category: 'Graph Representations', words: ['Adjacency Matrix', 'Adjacency List', 'Edge List', 'Incidence'], color: '#6eb4f8' },
      { category: 'Things With a "Scope"', words: ['Variable', 'Function', 'Block', 'Closure'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 44 ──
  {
    groups: [
      { category: 'Web APIs', words: ['Fetch', 'WebSocket', 'IndexedDB', 'Geolocation'], color: '#f8d74e' },
      { category: 'Sorting (Non-Comparison)', words: ['Radix', 'Counting', 'Bucket', 'Pigeonhole'], color: '#7ed66e' },
      { category: 'Unicode Concepts', words: ['Codepoint', 'Glyph', 'Surrogate', 'Grapheme'], color: '#6eb4f8' },
      { category: '___ Injection (All Different)', words: ['Constructor', 'Setter', 'Method', 'Field'], color: '#c97ed6' },
    ],
  },
  // ── Puzzle 45 ──
  {
    groups: [
      { category: 'State Management', words: ['Redux', 'MobX', 'Zustand', 'Recoil'], color: '#f8d74e' },
      { category: 'Networking Tools', words: ['ping', 'traceroute', 'nslookup', 'netstat'], color: '#7ed66e' },
      { category: 'Memory Hierarchy', words: ['L1 Cache', 'L2 Cache', 'RAM', 'Disk'], color: '#6eb4f8' },
      { category: 'Things You "Mount"', words: ['Component', 'Volume', 'Drive', 'File System'], color: '#c97ed6' },
    ],
  },
];

export default CONNECTIONS_PUZZLES;
