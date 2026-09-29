// Shared between the server (require) and both pages (<script src="/shared.js">).
(function (root) {
  const CHARACTERS = [
    { id: 'fox', emoji: '🦊', name: 'Fox', color: '#ff8a3d' },
    { id: 'frog', emoji: '🐸', name: 'Frog', color: '#6fd35b' },
    { id: 'panda', emoji: '🐼', name: 'Panda', color: '#e6e6f0' },
    { id: 'koala', emoji: '🐨', name: 'Koala', color: '#a9b4c2' },
    { id: 'tiger', emoji: '🐯', name: 'Tiger', color: '#ffb02e' },
    { id: 'lion', emoji: '🦁', name: 'Lion', color: '#f2c14e' },
    { id: 'pig', emoji: '🐷', name: 'Pig', color: '#ff9fb5' },
    { id: 'cow', emoji: '🐮', name: 'Cow', color: '#f0f0f0' },
    { id: 'monkey', emoji: '🐵', name: 'Monkey', color: '#c68b59' },
    { id: 'dog', emoji: '🐶', name: 'Dog', color: '#d9a066' },
    { id: 'cat', emoji: '🐱', name: 'Cat', color: '#ffd166' },
    { id: 'mouse', emoji: '🐭', name: 'Mouse', color: '#c9c9d6' },
    { id: 'hamster', emoji: '🐹', name: 'Hamster', color: '#f4b183' },
    { id: 'bunny', emoji: '🐰', name: 'Bunny', color: '#f7d6e0' },
    { id: 'bear', emoji: '🐻', name: 'Bear', color: '#b07d56' },
    { id: 'polarbear', emoji: '🐻‍❄️', name: 'Polar Bear', color: '#dff3ff' },
    { id: 'wolf', emoji: '🐺', name: 'Wolf', color: '#9aa3b5' },
    { id: 'raccoon', emoji: '🦝', name: 'Raccoon', color: '#8d8d99' },
    { id: 'chicken', emoji: '🐔', name: 'Chicken', color: '#fff1c1' },
    { id: 'penguin', emoji: '🐧', name: 'Penguin', color: '#7aa5d6' },
    { id: 'owl', emoji: '🦉', name: 'Owl', color: '#b08968' },
    { id: 'octopus', emoji: '🐙', name: 'Octopus', color: '#ff6f91' },
    { id: 'whale', emoji: '🐳', name: 'Whale', color: '#5ab0ff' },
    { id: 'turtle', emoji: '🐢', name: 'Turtle', color: '#5cc08a' },
    { id: 'bee', emoji: '🐝', name: 'Bee', color: '#ffd23f' },
    { id: 'flamingo', emoji: '🦩', name: 'Flamingo', color: '#ff7eb6' },
    { id: 'sloth', emoji: '🦥', name: 'Sloth', color: '#b39c7d' },
    { id: 'otter', emoji: '🦦', name: 'Otter', color: '#9c6b4e' },
    { id: 'trex', emoji: '🦖', name: 'T-Rex', color: '#57c46b' },
    { id: 'dragon', emoji: '🐲', name: 'Dragon', color: '#4cd07d' },
    { id: 'unicorn', emoji: '🦄', name: 'Unicorn', color: '#d59bff' },
    { id: 'alien', emoji: '👽', name: 'Alien', color: '#9be564' },
    { id: 'robot', emoji: '🤖', name: 'Robot', color: '#9ab0c8' },
    { id: 'ghost', emoji: '👻', name: 'Ghost', color: '#eeeeff' },
    { id: 'pumpkin', emoji: '🎃', name: 'Pumpkin', color: '#ff9a3c' },
    { id: 'cowboy', emoji: '🤠', name: 'Cowboy', color: '#e0a96d' },
  ];

  const LIMITS = {
    NAME_MAX: 14,
    ANSWER_MAX: 80,
    MIN_PLAYERS: 3,
    MAX_PLAYERS: 40,
    ROUNDS_MIN: 3,
    ROUNDS_MAX: 7,
    ANSWER_SECONDS: [45, 60, 90],
    CUSTOM_PROMPTS_MAX: 20,
    PROMPT_MAX: 120,
  };

  const byId = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
  const api = { CHARACTERS, LIMITS, character: (id) => byId[id] || null };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PD = api;
})(this);
