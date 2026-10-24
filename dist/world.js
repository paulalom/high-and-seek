/* High and Seek: hand-built mansion layout. Coordinates are world units. */
(function () {
  'use strict';

  const rooms = [
    { id: 'library', name: 'The Library', shortName: 'Library', x: 1, y: 1, w: 8, h: 9, floor: '#8c775f', palette: { wall: '#cec7a5', accent: '#6b7650' }, description: 'A little light reading. A lot of snacking.' },
    { id: 'kitchen', name: 'Midnight Kitchen', shortName: 'Kitchen', x: 11, y: 1, w: 8, h: 9, floor: '#cabd99', palette: { wall: '#ded4b7', accent: '#708066' }, description: 'Follow your nose. And the crumbs.' },
    { id: 'arcade', name: 'The Game Room', shortName: 'Game room', x: 21, y: 1, w: 8, h: 9, floor: '#85796a', palette: { wall: '#c6c1a6', accent: '#728e7c' }, description: 'High scores. Higher snack standards.' },
    { id: 'lounge', name: 'The Snack Lounge', shortName: 'Lounge', x: 1, y: 12, w: 8, h: 9, floor: '#ae8a6a', palette: { wall: '#d1c4a3', accent: '#c69d56' }, description: 'Your couch, your TV, and the place to bring the haul home.' },
    { id: 'foyer', name: 'The Grand Foyer', shortName: 'Foyer', x: 11, y: 12, w: 8, h: 9, floor: '#cec8ac', palette: { wall: '#e1d8ba', accent: '#8d9264' }, description: 'Welcome home. You left something delicious here.' },
    { id: 'conservatory', name: 'The Conservatory', shortName: 'Conservatory', x: 21, y: 12, w: 8, h: 9, floor: '#acb29a', palette: { wall: '#c8d0aa', accent: '#5f7a47' }, description: 'Good plants. Better hiding spots.' }
  ];

  // Rugs are decorative. All solid furniture has an honest collision footprint.
  const furniture = [
    { type: 'rug', room: 'library', x: 2.1, y: 4.4, w: 5.6, h: 3.6, color: '#65724f', solid: false },
    { type: 'shelf', room: 'library', x: 1.4, y: 1.35, w: 6.9, h: 0.85, color: '#695442', orientation: 'north' },
    { type: 'sofa', room: 'library', x: 1.8, y: 5.1, w: 2.5, h: 1.35, color: '#81905f', orientation: 'south' },
    { type: 'table', room: 'library', x: 5.5, y: 3.45, w: 2.4, h: 1.35, color: '#956e48' },
    { type: 'chair', room: 'library', x: 6.0, y: 6.8, w: 1.25, h: 1.2, color: '#bb9c5e', orientation: 'north' },
    { type: 'lamp', room: 'library', x: 2.1, y: 3.7, w: 0.5, h: 0.5, color: '#e1c37b' },
    { type: 'planter', room: 'library', x: 7.65, y: 8.35, w: 0.7, h: 0.7, color: '#55734b' },

    { type: 'kitchenCounter', room: 'kitchen', x: 11.45, y: 1.4, w: 5.6, h: 1.1, color: '#78856b', orientation: 'north' },
    { type: 'kitchenCounter', room: 'kitchen', x: 17.05, y: 1.4, w: 1.45, h: 1.1, color: '#78856b', orientation: 'north' },
    { type: 'fridge', room: 'kitchen', x: 17.2, y: 3.0, w: 1.15, h: 1.1, color: '#d5d3ba' },
    { type: 'island', room: 'kitchen', x: 13.65, y: 4.9, w: 3.0, h: 1.45, color: '#919c78' },
    { type: 'chair', room: 'kitchen', x: 13.85, y: 7.05, w: 0.65, h: 0.65, color: '#98764f' },
    { type: 'chair', room: 'kitchen', x: 15.65, y: 7.05, w: 0.65, h: 0.65, color: '#98764f' },
    { type: 'planter', room: 'kitchen', x: 11.55, y: 8.4, w: 0.65, h: 0.65, color: '#588052' },

    { type: 'rug', room: 'arcade', x: 22.1, y: 3.2, w: 5.3, h: 4.3, color: '#607976', solid: false },
    { type: 'arcade', room: 'arcade', x: 21.5, y: 1.5, w: 1.2, h: 1.25, color: '#b88d66', orientation: 'south' },
    { type: 'arcade', room: 'arcade', x: 23.1, y: 1.5, w: 1.2, h: 1.25, color: '#738c80', orientation: 'south' },
    { type: 'arcade', room: 'arcade', x: 24.7, y: 1.5, w: 1.2, h: 1.25, color: '#9a785e', orientation: 'south' },
    { type: 'poolTable', room: 'arcade', x: 23.0, y: 4.0, w: 3.7, h: 2.15, color: '#527c6a' },
    { type: 'table', room: 'arcade', x: 26.65, y: 7.5, w: 1.35, h: 1.05, color: '#9b8058' },
    { type: 'chair', room: 'arcade', x: 21.65, y: 7.3, w: 1.15, h: 1.2, color: '#bf9f65', orientation: 'east' },
    { type: 'planter', room: 'arcade', x: 27.7, y: 1.6, w: 0.7, h: 0.7, color: '#5f7c52' },

    { type: 'rug', room: 'lounge', x: 2.0, y: 14.25, w: 5.8, h: 4.7, color: '#c5a66f', solid: false },
    { type: 'sofa', room: 'lounge', x: 1.6, y: 14.5, w: 1.35, h: 3.2, color: '#d2ad63', orientation: 'east' },
    { type: 'sofa', room: 'lounge', x: 3.5, y: 18.5, w: 3.3, h: 1.25, color: '#c39b54', orientation: 'north' },
    { type: 'table', room: 'lounge', x: 4.5, y: 16.0, w: 2.35, h: 1.2, color: '#85684b' },
    { type: 'television', room: 'lounge', x: 6.55, y: 13.1, w: 1.65, h: 0.65, color: '#494e43', orientation: 'south' },
    { type: 'lamp', room: 'lounge', x: 1.55, y: 19.25, w: 0.55, h: 0.55, color: '#e1c58e' },
    { type: 'planter', room: 'lounge', x: 7.7, y: 19.5, w: 0.65, h: 0.65, color: '#66804b' },

    { type: 'rug', room: 'foyer', x: 13.0, y: 16.1, w: 4.0, h: 3.65, color: '#89915f', solid: false },
    { type: 'table', room: 'foyer', x: 13.6, y: 14.25, w: 2.65, h: 1.1, color: '#a98c5e' },
    { type: 'statue', room: 'foyer', x: 11.6, y: 13.1, w: 0.95, h: 0.95, color: '#dfd8bd' },
    { type: 'statue', room: 'foyer', x: 17.45, y: 13.1, w: 0.95, h: 0.95, color: '#dfd8bd' },
    { type: 'planter', room: 'foyer', x: 11.75, y: 19.2, w: 0.85, h: 0.85, color: '#6b7f4e' },
    { type: 'planter', room: 'foyer', x: 17.5, y: 19.2, w: 0.85, h: 0.85, color: '#6b7f4e' },

    { type: 'planter', room: 'conservatory', x: 21.6, y: 13.0, w: 1.15, h: 1.0, color: '#6b864a' },
    { type: 'planter', room: 'conservatory', x: 23.3, y: 13.0, w: 1.15, h: 1.0, color: '#829854' },
    { type: 'planter', room: 'conservatory', x: 27.0, y: 13.0, w: 1.15, h: 1.0, color: '#536f47' },
    { type: 'planter', room: 'conservatory', x: 21.6, y: 18.8, w: 1.15, h: 1.0, color: '#5e7b46' },
    { type: 'planter', room: 'conservatory', x: 23.3, y: 19.2, w: 1.15, h: 1.0, color: '#6f8d50' },
    { type: 'fountain', room: 'conservatory', x: 23.3, y: 15.2, w: 2.55, h: 2.15, color: '#9fa78a' },
    { type: 'chair', room: 'conservatory', x: 27.0, y: 15.65, w: 1.05, h: 1.25, color: '#ba9c61', orientation: 'west' },
    { type: 'table', room: 'conservatory', x: 26.25, y: 18.1, w: 1.45, h: 1.05, color: '#a58b60' }
  ];

  // Upstairs is a separate storey, not an extension of the ground-floor map.
  const upstairsRooms = [
    { id: 'cinema', name: 'The Private Cinema', shortName: 'Cinema', x: 1, y: 1, w: 8, h: 9, floor: '#8b7b83', palette: { wall: '#cfbec6', accent: '#806780' }, description: 'A movie marathon with an unattended snack supply.' },
    { id: 'pantry', name: 'The Secret Snack Pantry', shortName: 'Snack pantry', x: 11, y: 1, w: 8, h: 9, floor: '#b9bd99', palette: { wall: '#d6d5b6', accent: '#809160' }, description: 'The jackpot is upstairs. Everyone else knows it too.' },
    { id: 'party', name: 'The Afterparty Room', shortName: 'Afterparty', x: 21, y: 1, w: 8, h: 9, floor: '#9b8393', palette: { wall: '#d4c1ca', accent: '#927487' }, description: 'Great snacks. Very long stories.' },
    { id: 'suite', name: 'The Guest Suite', shortName: 'Guest suite', x: 1, y: 12, w: 8, h: 9, floor: '#b99a7b', palette: { wall: '#d8cbb5', accent: '#aa8865' }, description: 'Someone brought enough snacks for a much longer stay.' },
    { id: 'upperLanding', name: 'The Upper Landing', shortName: 'Upper landing', x: 11, y: 12, w: 8, h: 9, floor: '#c3b999', palette: { wall: '#dbd0b9', accent: '#8e8a68' }, description: 'Find the stairs again before your social battery is empty.' },
    { id: 'studio', name: 'The Creative Studio', shortName: 'Studio', x: 21, y: 12, w: 8, h: 9, floor: '#a8aaa0', palette: { wall: '#d1d1bd', accent: '#829284' }, description: 'Half-finished projects. Very finished snack plans.' }
  ];
  const upstairsFurniture = [
    { type: 'rug', room: 'cinema', x: 1.7, y: 3.3, w: 6.5, h: 5.5, color: '#826b7a', solid: false },
    { type: 'television', room: 'cinema', x: 3.45, y: 1.55, w: 3.15, h: .7, color: '#51565a', orientation: 'south' },
    { type: 'sofa', room: 'cinema', x: 2, y: 4.1, w: 5.2, h: 1.1, color: '#917b93', orientation: 'north' },
    { type: 'sofa', room: 'cinema', x: 2, y: 7, w: 5.2, h: 1.1, color: '#806b83', orientation: 'north' },
    { type: 'table', room: 'cinema', x: 1.45, y: 2.7, w: .85, h: 1, color: '#9e8569' },
    { type: 'table', room: 'cinema', x: 7.35, y: 5.8, w: .85, h: 1, color: '#9e8569' },
    { type: 'lamp', room: 'cinema', x: 7.8, y: 2, w: .5, h: .5, color: '#dfb87e' },

    { type: 'kitchenCounter', room: 'pantry', x: 11.45, y: 1.4, w: 7, h: 1.1, color: '#9aab79', orientation: 'north' },
    { type: 'island', room: 'pantry', x: 12.1, y: 4, w: 2.4, h: 1.4, color: '#9ba77c' },
    { type: 'island', room: 'pantry', x: 15.8, y: 4, w: 2.4, h: 1.4, color: '#8b9f75' },
    { type: 'shelf', room: 'pantry', x: 11.5, y: 7.3, w: 4.2, h: .75, color: '#9d8763' },
    { type: 'fridge', room: 'pantry', x: 17.4, y: 7.05, w: 1, h: 1.15, color: '#c5cfad' },

    { type: 'rug', room: 'party', x: 22.2, y: 3.6, w: 5.7, h: 4.6, color: '#b18a99', solid: false },
    { type: 'sofa', room: 'party', x: 21.6, y: 1.4, w: 5.8, h: 1.3, color: '#b98b9b', orientation: 'south' },
    { type: 'table', room: 'party', x: 23.5, y: 4.5, w: 3.1, h: 1.5, color: '#aa876a' },
    { type: 'kitchenCounter', room: 'party', x: 27.3, y: 6.8, w: 1.15, h: 2.15, color: '#9c8b85' },
    { type: 'chair', room: 'party', x: 21.8, y: 7.15, w: 1.1, h: 1.1, color: '#bca56a', orientation: 'east' },
    { type: 'planter', room: 'party', x: 27.6, y: 1.5, w: .7, h: .7, color: '#7a925e' },

    { type: 'rug', room: 'suite', x: 2, y: 14, w: 5.8, h: 5, color: '#b5a180', solid: false },
    { type: 'sofa', room: 'suite', x: 1.6, y: 14.5, w: 1.3, h: 3.3, color: '#baa27b', orientation: 'east' },
    { type: 'table', room: 'suite', x: 4.1, y: 16.1, w: 2.4, h: 1.2, color: '#9a795c' },
    { type: 'shelf', room: 'suite', x: 3.9, y: 19.2, w: 4.2, h: .75, color: '#9d8569' },
    { type: 'television', room: 'suite', x: 6.6, y: 13.1, w: 1.65, h: .65, color: '#545b52', orientation: 'south' },
    { type: 'planter', room: 'suite', x: 1.5, y: 19.6, w: .7, h: .7, color: '#7b8e5d' },

    { type: 'rug', room: 'upperLanding', x: 13.1, y: 15.6, w: 3.8, h: 4.1, color: '#a09a72', solid: false },
    { type: 'table', room: 'upperLanding', x: 13.5, y: 13.4, w: 3, h: 1.1, color: '#b19873' },
    { type: 'planter', room: 'upperLanding', x: 11.65, y: 15.8, w: .8, h: .8, color: '#79915f' },
    { type: 'planter', room: 'upperLanding', x: 17.5, y: 15.8, w: .8, h: .8, color: '#79915f' },
    { type: 'sofa', room: 'upperLanding', x: 13.1, y: 19.2, w: 3.7, h: 1, color: '#a89c75', orientation: 'north' },

    { type: 'rug', room: 'studio', x: 22, y: 14, w: 5.8, h: 5.8, color: '#9eaca3', solid: false },
    { type: 'table', room: 'studio', x: 21.6, y: 13.2, w: 3.1, h: 1.2, color: '#a88e6a' },
    { type: 'table', room: 'studio', x: 25.9, y: 15.6, w: 2.4, h: 1.3, color: '#aa9270' },
    { type: 'piano', room: 'studio', x: 21.5, y: 18.5, w: 3.4, h: 1.35, color: '#71877b' },
    { type: 'shelf', room: 'studio', x: 26.1, y: 19.4, w: 2.3, h: .75, color: '#9d8468' },
    { type: 'chair', room: 'studio', x: 23.3, y: 16.4, w: 1.1, h: 1.15, color: '#baa375', orientation: 'east' }
  ];

  // A separate ground-floor wing is entered through a doorway, using the same
  // scene transition as the stairs. Its hall connects three generous rooms.
  const wingRooms = [
    { id: 'snackerDen', name: 'The Snack Den', shortName: 'Snack den', x: 1, y: 1, w: 12, h: 8, floor: '#b59a7b', palette: { wall: '#e1d0ac', accent: '#b98d5a' }, description: 'Nico is helping himself. You are not the only one with the munchies.' },
    { id: 'corgiPlayroom', name: 'The Corgi Clubhouse', shortName: 'Corgi clubhouse', x: 1, y: 12, w: 12, h: 9, floor: '#c4ad91', palette: { wall: '#e4d4bd', accent: '#c59079' }, description: 'Someone very small has very large dinner plans.' },
    { id: 'petKitchen', name: 'The Doggy Kitchen', shortName: 'Doggy kitchen', x: 16, y: 1, w: 13, h: 20, floor: '#b3c0a8', palette: { wall: '#d9e2c9', accent: '#8da87b' }, description: 'Waffles has a proper dinner bowl here. Bring your little friend over.' }
  ];
  const wingFurniture = [
    { type: 'rug', room: 'snackerDen', x: 2.5, y: 3.3, w: 8.8, h: 4.6, color: '#bfa56f', solid: false },
    { type: 'sofa', room: 'snackerDen', x: 2, y: 1.6, w: 5.2, h: 1.2, color: '#c6a15e', orientation: 'south' },
    { type: 'table', room: 'snackerDen', x: 8.4, y: 2.4, w: 2.5, h: 1.5, color: '#a78055' },
    { type: 'table', room: 'snackerDen', x: 5.7, y: 5.7, w: 2.3, h: .9, color: '#a78055' },
    { type: 'kitchenCounter', room: 'snackerDen', x: 1.6, y: 5.7, w: 1, h: 2.2, color: '#9da779' },
    { type: 'shelf', room: 'snackerDen', x: 9.8, y: 1.4, w: 2.4, h: .75, color: '#9c805f' },
    { type: 'chair', room: 'snackerDen', x: 10.5, y: 6.8, w: 1, h: 1, color: '#b99a6c', orientation: 'west' },
    { type: 'planter', room: 'snackerDen', x: 1.5, y: 1.5, w: .7, h: .7, color: '#789460' },
    { type: 'rug', room: 'corgiPlayroom', x: 3.5, y: 14.1, w: 7.8, h: 5.4, color: '#cfa68a', solid: false },
    { type: 'rug', room: 'corgiPlayroom', x: 4.3, y: 18.5, w: 2.7, h: 1.3, color: '#dabb9b', solid: false },
    { type: 'sofa', room: 'corgiPlayroom', x: 1.6, y: 13.4, w: 1.35, h: 4.1, color: '#bbaa82', orientation: 'east' },
    { type: 'shelf', room: 'corgiPlayroom', x: 2.2, y: 19.5, w: 4, h: .8, color: '#aa916f' },
    { type: 'chair', room: 'corgiPlayroom', x: 10, y: 13.2, w: 1.1, h: 1, color: '#d2ab79', orientation: 'south' },
    { type: 'planter', room: 'corgiPlayroom', x: 10.8, y: 19.2, w: .8, h: .8, color: '#789460' },
    { type: 'rug', room: 'petKitchen', x: 18, y: 13.9, w: 7.6, h: 5.5, color: '#b4c49b', solid: false },
    { type: 'kitchenCounter', room: 'petKitchen', x: 18, y: 1.5, w: 8.5, h: 1.1, color: '#99ac80', orientation: 'north' },
    { type: 'island', room: 'petKitchen', x: 22.5, y: 6, w: 3.8, h: 1.8, color: '#9cae87' },
    { type: 'kitchenCounter', room: 'petKitchen', x: 27.2, y: 12, w: 1.2, h: 3, color: '#99ac80', orientation: 'east' },
    { type: 'fridge', room: 'petKitchen', x: 27.1, y: 3.5, w: 1.2, h: 1.3, color: '#d4dcca' },
    { type: 'shelf', room: 'petKitchen', x: 18, y: 19.2, w: 5.7, h: .8, color: '#b49c77' },
    { type: 'planter', room: 'petKitchen', x: 27.3, y: 19.2, w: .8, h: .8, color: '#769365' }
  ];

  const snackKinds = [
    { id: 'cookies', name: 'Cosmic Cookies', icon: '🍪', room: 'library', energy: 22, hidingSpots: [{ x: 6.65, y: 4.05 }, { x: 7.65, y: 2.05 }, { x: 6.55, y: 7.3 }], detail: 'A literary snack. No crumbs in the first editions.' },
    { id: 'chips', name: 'Couch Chips', icon: '🥔', room: 'library', energy: 19, hidingSpots: [{ x: 2.75, y: 5.65 }, { x: 3.75, y: 5.7 }, { x: 2.4, y: 2.0 }], detail: 'The bag was mostly air. Still counts.' },
    { id: 'nachos', name: 'Legendary Nachos', icon: '🧀', room: 'kitchen', energy: 26, hidingSpots: [{ x: 15.15, y: 5.5 }, { x: 13.95, y: 5.65 }, { x: 12.6, y: 2.0 }], detail: 'The cheese-to-chip ratio is a work of art.' },
    { id: 'icecream', name: 'Midnight Ice Cream', icon: '🍦', room: 'kitchen', energy: 21, hidingSpots: [{ x: 16.55, y: 1.95 }, { x: 15.5, y: 1.95 }, { x: 17.75, y: 3.7 }], detail: 'A little melted. A lot delicious.' },
    { id: 'soda', name: 'Pixel Pop', icon: '🥤', room: 'arcade', energy: 16, hidingSpots: [{ x: 27.3, y: 7.95 }, { x: 21.95, y: 7.8 }, { x: 23.55, y: 2.15 }], detail: 'Achievement unlocked: carbonated happiness.' },
    { id: 'pizza', name: 'Emergency Pizza', icon: '🍕', room: 'lounge', energy: 29, hidingSpots: [{ x: 5.65, y: 16.55 }, { x: 5.1, y: 19.0 }, { x: 2.5, y: 16.1 }], detail: 'Cold pizza. Warm memories.' },
    { id: 'donut', name: 'Welcome-Home Donut', icon: '🍩', room: 'foyer', energy: 24, hidingSpots: [{ x: 14.95, y: 14.75 }, { x: 12.1, y: 13.55 }, { x: 17.9, y: 13.55 }], detail: 'A perfectly round reason to keep going.' },
    { id: 'gummies', name: 'Garden Gummies', icon: '🍬', room: 'conservatory', energy: 22, hidingSpots: [{ x: 26.95, y: 18.55 }, { x: 22.15, y: 13.5 }, { x: 23.85, y: 19.65 }], detail: 'Botanically questionable. Exceptionally chewy.' }
  ];
  const upstairsSpotsByRoom = {
    cinema: [[1.85, 3.2], [3, 4.6], [5.2, 4.6], [6.6, 4.6], [3, 7.5], [5.2, 7.5], [8.05, 6.3]],
    pantry: [[12, 1.95], [13, 1.95], [14, 1.95], [15, 1.95], [16, 1.95], [17, 1.95], [18, 1.95], [12.5, 4.7], [13.9, 4.7], [16.2, 4.7], [17.6, 4.7], [13, 7.65], [15, 7.65], [17.9, 7.6]],
    party: [[22.2, 2.55], [24, 2.55], [26.2, 2.55], [24, 5.2], [25.9, 5.2], [27.8, 7.2], [27.8, 8.3]],
    suite: [[2.5, 15.2], [2.5, 17], [4.65, 16.65], [6.05, 16.65], [4.6, 19.55], [7.45, 19.55]],
    upperLanding: [[13.95, 13.95], [15.9, 13.95], [13.65, 19.65], [15.95, 19.65], [11.95, 16.1]],
    studio: [[22.1, 13.8], [24.2, 13.8], [26.4, 16.25], [27.8, 16.25], [22.2, 19.05], [27.2, 19.75]]
  };
  const wingSpotsByRoom = {
    snackerDen: [[3, 2.55], [5, 2.55], [6.5, 2.55], [8.8, 3.6], [10.2, 3.6], [2.1, 6], [2.1, 7.1], [4.2, 7.4], [5.4, 7.5], [7.6, 7.5], [9.5, 7.7], [6.3, 6.1], [7.4, 6.1], [11.4, 5.1]],
    corgiPlayroom: [[2.7, 14.2], [2.7, 16.3], [3, 19.7], [4.7, 19.7], [5.8, 19.7], [10.5, 14], [8.8, 15], [9.5, 18]],
    petKitchen: [[19, 2.1], [23, 2.1], [26, 2.1], [23.2, 7.6], [25, 7.6], [27.45, 13]]
  };
  const snackSpots = [
    ...snackKinds.flatMap(kind => kind.hidingSpots.map((spot, index) => ({ id: `${kind.id}-${index}`, room: kind.room, level: 0, ...spot }))),
    ...Object.entries(upstairsSpotsByRoom).flatMap(([room, positions]) => positions.map(([x, y], index) => ({ id: `up-${room}-${index}`, room, level: 1, x, y }))),
    ...Object.entries(wingSpotsByRoom).flatMap(([room, positions]) => positions.map(([x, y], index) => ({ id: `wing-${room}-${index}`, room, level: 2, x, y })))
  ];
  const snacks = [];
  const kindsByRoom = {
    library: ['cookies', 'chips', 'gummies'], kitchen: ['nachos', 'icecream', 'donut', 'pizza'],
    arcade: ['soda', 'chips', 'cookies'], lounge: ['pizza', 'chips', 'soda'],
    foyer: ['donut', 'cookies', 'gummies'], conservatory: ['gummies', 'cookies', 'soda'],
    cinema: ['pizza', 'chips', 'soda'], pantry: ['nachos', 'donut', 'icecream', 'cookies'],
    party: ['soda', 'chips', 'pizza'], suite: ['cookies', 'gummies', 'donut'],
    upperLanding: ['chips', 'cookies', 'soda'], studio: ['gummies', 'donut', 'pizza'],
    snackerDen: ['chips', 'cookies', 'pizza', 'donut'], corgiPlayroom: ['cookies', 'chips', 'gummies', 'donut'], petKitchen: ['cookies', 'chips', 'soda']
  };
  const roomClues = {
    library: 'Search the library seating and shelves. Someone got hungry mid-chapter.',
    kitchen: 'The kitchen has a midnight secret. Check its worktops and fridge.',
    arcade: 'Every high score deserves a little refreshment. Search the game room.',
    lounge: 'Check around the lounge seating. Someone prepared a very snackable movie night.',
    foyer: 'A grand entrance deserves a tasty welcome. Check the foyer displays.',
    conservatory: 'A small treat is hiding among your leafy roommates.',
    cinema: 'Head upstairs to the cinema. The best movie snacks are between screenings.',
    pantry: 'Upstairs, the secret pantry is stocked. Search the counters and shelves.',
    party: 'The upstairs afterparty has leftovers. Try to avoid another long story.',
    suite: 'The guest suite upstairs has snacks tucked around its furniture.',
    upperLanding: 'There are snacks on the upper landing. Remember where the stairs are.',
    studio: 'Search the upstairs studio worktables. Creative work takes fuel.',
    snackerDen: 'Nico is eating his way around the wing snack den. Search the tables and seating.',
    corgiPlayroom: 'Waffles has company snacks around his clubhouse seating and shelves. His dinner is in the kitchen bowl.',
    petKitchen: 'There are munchies around the wing kitchen counters. The bowl is for Waffles.'
  };
  const home = { room: 'lounge', level: 0, x: 4, y: 17.65, radius: 1.6, name: 'The Snack Lounge' };

  function buildWalls(floorRooms, level) {
    const result = [
      { x: 0.82, y: 0.82, w: 28.36, h: 0.18, exterior: true, level },
      { x: 0.82, y: 0.82, w: 0.18, h: 20.36, exterior: true, level },
      { x: 29, y: 0.82, w: 0.18, h: 20.36, exterior: true, level },
      { x: 0.82, y: 21, w: 28.36, h: 0.18, exterior: true, level }
    ];
    floorRooms.forEach(room => {
      // Side walls leave the central east-west gallery open on both storeys.
      if (room.x !== 1) result.push({ x: room.x - 0.08, y: room.y, w: 0.16, h: room.h, room: room.id, level });
      if (room.x !== 21) result.push({ x: room.x + room.w - 0.08, y: room.y, w: 0.16, h: room.h, room: room.id, level });
      const y = room.y === 1 ? 9.88 : 12.0;
      result.push({ x: room.x, y, w: 2.5, h: 0.16, room: room.id, level });
      result.push({ x: room.x + 5.5, y, w: 2.5, h: 0.16, room: room.id, level });
    });
    return result;
  }
  function buildWingWalls() {
    const result = buildWalls([], 2);
    const wall = (room, x, y, w, h) => result.push({ room, x, y, w, h, level: 2 });
    // Wide doorways leave a clear route for both the player and a following dog.
    wall('snackerDen', 12.92, 1, .16, 3.4);
    wall('snackerDen', 12.92, 6.8, .16, 2.2);
    wall('snackerDen', 1, 8.92, 4.1, .16);
    wall('snackerDen', 8.9, 8.92, 4.1, .16);
    wall('corgiPlayroom', 12.92, 12, .16, 3);
    wall('corgiPlayroom', 12.92, 18, .16, 3);
    wall('corgiPlayroom', 1, 11.92, 4.1, .16);
    wall('corgiPlayroom', 8.9, 11.92, 4.1, .16);
    wall('petKitchen', 15.92, 1, .16, 7.8);
    wall('petKitchen', 15.92, 12.8, .16, 2.2);
    wall('petKitchen', 15.92, 18, .16, 3);
    return result;
  }
  const wing = {
    level: 2, name: 'Snack & Paws Wing', doorId: 'wing-entry',
    dog: { name: 'Waffles', level: 2, room: 'corgiPlayroom', x: 6.5, y: 16.5, radius: .25, maxEnergy: 100, startEnergy: 75, drain: 2.4, followSpeed: 3.5 },
    bowl: { x: 21, y: 16.5, radius: 1.3, room: 'petKitchen', level: 2 },
    eater: { id: 'snackBandit', name: 'Nico', level: 2, x: 6, y: 4.5, color: '#bc9a74', speed: 1.2, eatRadius: 1.15, eatDuration: 2.5, route: [{ x: 4, y: 4.5 }, { x: 10, y: 4.5 }, { x: 10, y: 7.4 }, { x: 4, y: 7.4 }] }
  };
  const floors = [
    { id: 0, kind: 'mansion', name: 'Ground floor', rooms, furniture, stair: { x: 15, y: 11, radius: 1.4, to: 1, arrival: { x: 15, y: 10.8 } }, doors: [{ id: 'wing-entry', x: 25, y: 11, radius: 1.35, to: 2, arrival: { x: 14.5, y: 11 }, label: 'Snack & Paws wing' }] },
    { id: 1, kind: 'mansion', name: 'Upstairs', rooms: upstairsRooms, furniture: upstairsFurniture, stair: { x: 15, y: 11, radius: 1.4, to: 0, arrival: { x: 15, y: 10.8 } }, doors: [] },
    { id: 2, kind: 'wing', name: 'Snack & Paws Wing', rooms: wingRooms, furniture: wingFurniture, walls: buildWingWalls(), doors: [{ id: 'wing-exit', x: 14.5, y: 11, radius: 1.35, to: 0, arrival: { x: 25, y: 10.8 }, label: 'Main mansion' }] }
  ];
  floors.forEach(floor => {
    floor.rooms.forEach(room => { room.level = floor.id; });
    floor.furniture.forEach(item => { item.level = floor.id; });
    floor.walls = floor.walls || buildWalls(floor.rooms, floor.id);
    floor.solids = floor.walls.concat(floor.furniture.filter(item => item.solid !== false));
    floor.collisionProfiles = floor.solids.map(createCollisionProfile);
  });
  // Guest routes stay in open aisles. They are temporary social obstacles,
  // rather than static furniture, so a conversation never seals off a room.
  const guests = [
    { id: 'filmBuff', name: 'Max', level: 1, x: 8.6, y: 3.4, color: '#b49add', line: 'Okay, but have you seen the director\'s cut?', route: [{ x: 8.6, y: 3.4 }, { x: 8.6, y: 8.8 }] },
    { id: 'snackExpert', name: 'Jules', level: 1, x: 14.95, y: 3.1, color: '#d8b46d', line: 'Let me explain my very specific nacho theory.', route: [{ x: 14.95, y: 3.1 }, { x: 14.95, y: 6.4 }, { x: 16.4, y: 6.4 }, { x: 14.95, y: 6.4 }] },
    { id: 'partyStory', name: 'Bea', level: 1, x: 22.4, y: 3.6, color: '#d98eaa', line: 'You will never guess what happened at the party.', route: [{ x: 22.4, y: 3.6 }, { x: 22.4, y: 6.4 }, { x: 26.9, y: 6.4 }, { x: 22.4, y: 6.4 }] },
    { id: 'houseGuest', name: 'Sam', level: 1, x: 7.5, y: 14.5, color: '#ddaa80', line: 'Quick question. How soft do you think this couch is?', route: [{ x: 7.5, y: 14.5 }, { x: 7.5, y: 18.5 }] },
    { id: 'creativeFriend', name: 'Leo', level: 1, x: 25.3, y: 14.9, color: '#81b8ad', line: 'I have a new idea. It only takes ten minutes to explain.', route: [{ x: 25.3, y: 14.9 }, { x: 25.3, y: 18.1 }, { x: 22.5, y: 18.1 }, { x: 25.3, y: 18.1 }] },
    { id: 'hallwayChat', name: 'Rae', level: 1, x: 10, y: 3, color: '#91afcf', line: 'Hey! Where are you rushing off to?', route: [{ x: 10, y: 3 }, { x: 10, y: 9.5 }, { x: 10, y: 13.5 }, { x: 10, y: 19 }] }
  ];

  const guestStories = {
    filmBuff: [
      "The theatrical version cut eleven minutes of hallway walking, destroying the mansion's emotional geography.",
      'I timed every door opening and found the pantry receives twice the dramatic tension.',
      'That close-up of the chip bag was practical effects. They hired an actual chip.',
      'The studio wanted a happier ending, so the sandwich survives in three separate timelines.',
      'Personally, I prefer the silent version, although the nacho crunching becomes quite difficult to subtitle.',
      'There is a commentary track for the commentary track. Mostly they discuss microphone placement.',
      'I submitted one question at the screening and accidentally became the entire question session.',
      'The director called my diagram unnecessary, which suggests he never understood the staircase motif.',
      'Every staircase represents ambition. Except this one, which represents carrying snacks upstairs carefully.',
      'I wrote that down before the movie started. Sometimes criticism must arrive ahead of evidence.',
      'My alternate ending is seventy minutes longer and gives the refrigerator a complicated childhood.',
      "The refrigerator's motivation is cold, obviously, but its relationship with the freezer needs space.",
      'People say cinema should move you. This sofa has moved me about three inches.',
      'We could test the surround sound, but I alphabetized the speakers by emotional availability.',
      'Notice how the remote disappears in act two. That is either symbolism or Bea.',
      "I found it under a cushion, which raises serious questions about the cushion's reliability.",
      'The cushion gets its own documentary next year. I have already disputed the trailer.',
      'Anyway, before you go, we should establish whether this conversation needs an extended edition.',
      'I brought the storyboards. The first forty pages explain why you entered the room.'
    ],
    snackExpert: [
      'First, a nacho is a load-bearing triangle operating under extremely questionable cheese conditions.',
      'I built a tiny suspension bridge from chips. The river was salsa, naturally.',
      'The first trial failed when a volunteer ate the central support during calibration.',
      'That volunteer was me, but science advances when researchers admit their structural weaknesses.',
      'We now classify every chip by crunch, curvature, and willingness to carry beans.',
      'A flat chip is a plate. A curled chip is a delicious little freight elevator.',
      'Do not mix those categories. Last time, the sour cream exceeded the building permit.',
      'I applied for funding using a spreadsheet that was mostly photos of melted cheese.',
      'The committee rejected my methods but asked whether the leftovers could attend their meeting.',
      'Naturally, I requested a tasting panel composed entirely of people who owe me favors.',
      'They discovered the perfect topping ratio shortly before someone sneezed near the control group.',
      'We had to restart. The control group had become significantly more seasoned than intended.',
      'My latest model predicts a cheese avalanche exactly four seconds after you lift the tray.',
      'Please stand back. The jalapenos are wearing tiny helmets, and morale is already low.',
      'A colleague suggested smaller portions. We no longer collaborate on matters of this importance.',
      'I moved the experiment upstairs because gravity seems less judgmental on the second floor.',
      'The data suggests every snack becomes healthier when you call it a research sample.',
      'I have not published that finding. The reviewers keep eating the supporting evidence first.',
      'Before you leave, could you hold this chip while I explain the appendix?'
    ],
    partyStory: [
      'It started when someone asked whose birthday it was, and three people said the house.',
      'We found a candle shaped like a key, which really changed the mood of the investigation.',
      'The key did not fit any door, but it opened a surprisingly heated group discussion.',
      'At that point, my cousin arrived wearing the same jacket as the living room curtains.',
      'Not these curtains. The previous curtains, which left the mansion under very unclear circumstances.',
      'She said it was vintage. The gardener said it was evidence. Both had excellent buttons.',
      'Then the DJ stopped because someone requested a song called Where Are My Shoes.',
      'It turned out to be a question, but everyone agreed the beat had potential.',
      'We searched the kitchen first, although nobody could explain why shoes would need refrigeration.',
      'The chef remembered a wedding where the cake arrived wearing a very tiny hat.',
      'The hat belonged to a magician, apparently, but he insisted the cake had borrowed it.',
      'Anyway, the shoes were in the cinema, politely facing the screen like two small guests.',
      'We gave them front row seats, and somebody said that counted as reserved footwear.',
      'Then Max reviewed their performance. He felt the left shoe had stronger emotional range.',
      'I was about to call a taxi when the cake magician finally found the pantry.',
      'His rabbit had been there all evening, supervising the chips without any official authority.',
      'The rabbit cannot explain itself. Its publicist says it is focusing on new projects.',
      "So we formed a planning committee for next year, mostly to establish the rabbit's responsibilities.",
      'Wait, I skipped the important part. You need to know how the chandelier got invited.'
    ],
    houseGuest: [
      'I started with a simple question: can a couch be too comfortable for reliable scientific observation?',
      'The first participant fell asleep immediately, which I recorded as a very enthusiastic written response.',
      'Technically, the response was snoring, but I transcribed it using a surprisingly generous grading scale.',
      'Every cushion has a score for softness, bounce, and ability to conceal television remotes.',
      'This one swallowed three remotes and a postcard from someone who never stayed here.',
      'I suspect the couch has a social life that continues while we are all upstairs.',
      'We tried interviewing it, but the armrest offered only a firm and deeply supportive silence.',
      'The recliner released a statement denying any relationship with the missing throw pillows.',
      'I have compared thirty-seven sitting positions. Number twelve requires a snack and no further ambition.',
      'Number thirteen is legally a nap, so the ethics committee asked us to use blankets.',
      'The committee is me wearing glasses, but I do take its concerns very seriously.',
      'A feather escaped during testing. We listed it as an unexpected departure from the research team.',
      'Now every pillow needs a tiny identification badge, making washing day unnecessarily bureaucratic.',
      'The guest suite couch scored highest, but it may have bribed a judge with loose change.',
      'We found eight coins under its cushions. That is suspiciously close to a research grant.',
      'I am developing a comfort scale measured in how unlikely you are to answer the door.',
      'This sofa rates eleven missed deliveries and a heartfelt apology to the pizza guy.',
      'The final report is nearly finished. Sadly, the best place to write it keeps making me sleepy.',
      'Could you sit down briefly? I need a second opinion before publishing the three-volume conclusion.'
    ],
    creativeFriend: [
      'Imagine an app that reminds you to open the app that manages all your other reminders.',
      'It is called Later, but our legal team says that name has already been taken by tomorrow.',
      'So we pivoted to a smart coaster that knows when you have forgotten your drink.',
      'The first prototype texted my ex because it mistook emotional distance for an empty glass.',
      'We fixed that by removing texting and adding a subscription for advanced condensation.',
      'Investors love recurring moisture. I put that phrase on slide seven in a very large font.',
      'Our research asked people whether they owned cups. The results were almost universally promising.',
      'Then we discovered bowls, expanding the market and completely overwhelming the engineering team.',
      'I hired a consultant to explain bowls. Her report recommends further research into spoons.',
      'The premium spoon will have no electronics. That is how we know the design is disruptive.',
      'Customers upgrade it by imagining a more expensive spoon while eating their breakfast cereal.',
      'We are building a platform where chairs rent spare sitting time to other chairs.',
      'People keep asking who actually sits down. An excellent question for our next funding round.',
      'The model is flexible because we have not identified what the business actually does.',
      'I made a logo that looks like a cloud holding a smaller, more ambitious cloud.',
      'Nobody understood it in testing, which means we probably need a much larger launch party.',
      'Our prototype toaster currently believes it is the head of human resources for this entire mansion.',
      'It scheduled a performance review with the kettle, and I respect that kind of initiative.',
      'Anyway, can I list you as an adviser? You have listened longer than our board.'
    ],
    hallwayChat: [
      'The first rule of mansion etiquette is never admit you have no idea which hallway this is.',
      'Simply walk with purpose until a statue looks familiar, then compliment its excellent sense of direction.',
      'That statue is the east wing guide. Someone rotated it during the last spring cleaning.',
      'We now give directions using chandeliers, although several insist on answering to the same name.',
      'Please address this one as Your Brightness. It has become difficult about casual introductions.',
      'The pantry door prefers a gentle knock, even when you can see it is already open.',
      'Guests who ignore that custom receive a very detailed lecture about respectful hinge maintenance.',
      'I deliver it myself. The hinges have asked that their remarks remain off the record.',
      'On your left is the portrait gallery. Every ancestor claims they personally invented the weekend.',
      'On your right is a decorative door. It leads nowhere, but receives excellent online reviews.',
      'The upstairs carpet has a formal dress code, mostly involving not stepping on it with soup.',
      'We learned that during the annual soup procession. There will not be another soup procession.',
      'If you need the bathroom, follow the tasteful signs until they become increasingly vague and philosophical.',
      'The arrow marked Perhaps points toward the conservatory. We are still investigating why.',
      'Returning guests may use the staircase without introducing themselves to every single step this time.',
      'Running past another guest requires a brief apology, preferably accompanied by an elaborate bow.',
      'I see you are carrying snacks. Mansion policy requires an entirely informal inspection of deliciousness.',
      'You may refuse the inspection, but I will need to explain the appeals procedure in detail.',
      'The appeals desk is downstairs. First, let me explain the correct way to approach it politely.'
    ]
  };
  guests.forEach(guest => { guest.monologue = [guest.line, ...guestStories[guest.id]]; });

  function createCollisionProfile(solid) {
    const fallback = solid.exterior ? 0 : solid.room && solid.type ? .22 : .07;
    const requested = Number.isFinite(solid.cornerRadius) && solid.cornerRadius >= 0 ? solid.cornerRadius : fallback;
    const cornerRadius = solid.exterior ? 0 : Math.min(requested, solid.w / 2, solid.h / 2);
    solid.cornerRadius = cornerRadius;
    return {
      solid, x: solid.x, y: solid.y, w: solid.w, h: solid.h, cornerRadius,
      insetMinX: solid.x + cornerRadius, insetMaxX: solid.x + solid.w - cornerRadius,
      insetMinY: solid.y + cornerRadius, insetMaxY: solid.y + solid.h - cornerRadius
    };
  }

  // A rounded solid is the inset rectangle swept by its corner radius. Adding
  // the actor radius gives its exact circle collision shape, including faces.
  function clearance(profile, x, y, radius) {
    const qx = Math.max(profile.insetMinX, Math.min(x, profile.insetMaxX));
    const qy = Math.max(profile.insetMinY, Math.min(y, profile.insetMaxY));
    const dx = x - qx, dy = y - qy, roundedRadius = profile.cornerRadius + radius;
    if (dx || dy) return Math.hypot(dx, dy) - roundedRadius;
    // The inside branch matters for point actors too: radius zero must not
    // make the interior of a table or a wall walkable.
    return -Math.min(x - profile.insetMinX, profile.insetMaxX - x,
      y - profile.insetMinY, profile.insetMaxY - y) - roundedRadius;
  }

  function boxEntry(x, y, dx, dy, minX, minY, maxX, maxY) {
    if (maxX <= minX || maxY <= minY) return Infinity;
    let enter = 0, leave = 1;
    if (Math.abs(dx) < 1e-12) {
      if (x <= minX || x >= maxX) return Infinity;
    } else {
      const a = (minX - x) / dx, b = (maxX - x) / dx;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
    if (Math.abs(dy) < 1e-12) {
      if (y <= minY || y >= maxY) return Infinity;
    } else {
      const a = (minY - y) / dy, b = (maxY - y) / dy;
      enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
    return leave > enter + 1e-10 && leave > 0 && enter < 1 ? Math.max(0, enter) : Infinity;
  }

  function circleEntry(x, y, dx, dy, cx, cy, radius) {
    if (radius <= 0) return Infinity;
    const ox = x - cx, oy = y - cy, a = dx * dx + dy * dy;
    const b = ox * dx + oy * dy, c = ox * ox + oy * oy - radius * radius;
    const discriminant = b * b - a * c;
    // A tangent touches but does not enter the solid.
    if (a <= 0 || discriminant <= 1e-16) return Infinity;
    const enter = (-b - Math.sqrt(discriminant)) / a;
    if (enter < -1e-8 || enter >= 1) return Infinity;
    if (enter <= 1e-8 && b >= -1e-10) return Infinity;
    return Math.max(0, enter);
  }

  function solidEntry(profile, x, y, dx, dy, radius) {
    if (Math.max(x, x + dx) <= profile.x - radius || Math.min(x, x + dx) >= profile.x + profile.w + radius ||
        Math.max(y, y + dy) <= profile.y - radius || Math.min(y, y + dy) >= profile.y + profile.h + radius) return Infinity;
    const minX = profile.insetMinX, maxX = profile.insetMaxX;
    const minY = profile.insetMinY, maxY = profile.insetMaxY, r = profile.cornerRadius + radius;
    if (!r) return boxEntry(x, y, dx, dy, minX, minY, maxX, maxY);
    // These two strips and four circles are exactly the rounded rectangle.
    // Sweeping them catches even a shallow corner graze between endpoints.
    return Math.min(
      boxEntry(x, y, dx, dy, minX - r, minY, maxX + r, maxY),
      boxEntry(x, y, dx, dy, minX, minY - r, maxX, maxY + r),
      circleEntry(x, y, dx, dy, minX, minY, r),
      circleEntry(x, y, dx, dy, minX, maxY, r),
      circleEntry(x, y, dx, dy, maxX, minY, r),
      circleEntry(x, y, dx, dy, maxX, maxY, r)
    );
  }

  function slideStep(profiles, x, y, dx, dy, radius) {
    let px = x, py = y, vx = dx, vy = dy, distance = 0;
    for (let contact = 0; contact < 5; contact++) {
      const length = Math.hypot(vx, vy);
      if (length < 1e-9) break;
      let hit = Infinity;
      for (const profile of profiles) hit = Math.min(hit, solidEntry(profile, px, py, vx, vy, radius));
      if (hit === Infinity) { px += vx; py += vy; distance += length; break; }
      const contactX = px + vx * hit, contactY = py + vy * hit;
      const safeFraction = Math.max(0, hit - .00001 / length);
      px += vx * safeFraction; py += vy * safeFraction; distance += length * safeFraction;
      vx *= 1 - hit; vy *= 1 - hit;
      const normals = [];
      for (const profile of profiles) {
        if (clearance(profile, contactX, contactY, radius) > .00002) continue;
        const qx = Math.max(profile.insetMinX, Math.min(contactX, profile.insetMaxX));
        const qy = Math.max(profile.insetMinY, Math.min(contactY, profile.insetMaxY));
        let nx = contactX - qx, ny = contactY - qy, normalLength = Math.hypot(nx, ny);
        if (normalLength > 1e-10) { nx /= normalLength; ny /= normalLength; }
        else {
          const left = contactX - profile.insetMinX, right = profile.insetMaxX - contactX;
          const top = contactY - profile.insetMinY, bottom = profile.insetMaxY - contactY;
          const closest = Math.min(left, right, top, bottom);
          if (closest === left) { nx = -1; ny = 0; }
          else if (closest === right) { nx = 1; ny = 0; }
          else if (closest === top) { nx = 0; ny = -1; }
          else { nx = 0; ny = 1; }
        }
        normals.push(nx, ny);
      }
      if (!normals.length) break;
      // Resolve every simultaneous contact. Rechecking prevents projection onto
      // one wall from introducing motion through a second wall at a corner.
      for (let iteration = 0; iteration < 8; iteration++) {
        let adjusted = false;
        for (let i = 0; i < normals.length; i += 2) {
          const inward = vx * normals[i] + vy * normals[i + 1];
          if (inward < -1e-12) { vx -= inward * normals[i]; vy -= inward * normals[i + 1]; adjusted = true; }
        }
        if (!adjusted) break;
      }
      for (let i = 0; i < normals.length; i += 2) if (vx * normals[i] + vy * normals[i + 1] < -1e-9) { vx = 0; vy = 0; break; }
    }
    return { x: px, y: py, distance };
  }

  const world = {
    width: 30,
    height: 22,
    level: 0,
    floors,
    allRooms: floors.flatMap(floor => floor.rooms),
    rooms,
    furniture,
    guests,
    wing,
    snacks,
    snackKinds,
    snackSpots,
    walls: floors[0].walls,
    home,
    start: { x: home.x, y: home.y, level: 0 },
    collectionRadius: 1.2,
    playerRadius: 0.22,
    rules: { maxEnergy: 100, startEnergy: 100, idleDrain: 1.15, distanceDrain: 1.3, sprintMultiplier: 1.5, sprintDrainMultiplier: 1.8, discoveryRadius: 4.4, hints: 2, conversationRadius: 1.05, conversationDuration: 16, conversationLineDuration: 3.2, conversationCooldown: 6, conversationEscapePresses: 12, conversationEscapeCost: 4 },
    activateFloor(level) {
      const floor = floors.find(item => item.id === level);
      if (!floor) return false;
      this.level = floor.id;
      this.rooms = floor.rooms;
      this.furniture = floor.furniture;
      this.walls = floor.walls;
      return true;
    },
    // Build an unknown-sized haul from the validated placement pool. The array
    // itself stays stable for the renderer, but its contents change each run.
    shuffleSnacks(random = Math.random) {
      const next = () => {
        const value = Number(random());
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0;
      };
      const selected = floors.flatMap(floor => {
        const floorSpots = snackSpots.filter(spot => spot.level === floor.id);
        const count = floor.id === 0 ? 16 + Math.floor(next() * 7) : floor.id === 1 ? 32 + Math.floor(next() * 9) : 10 + Math.floor(next() * 7);
        const homeSpots = floorSpots.filter(spot => spot.room === home.room);
        const firstHome = homeSpots.length ? homeSpots[Math.floor(next() * homeSpots.length)] : null;
        const candidates = floorSpots.filter(spot => spot !== firstHome);
        for (let i = candidates.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        // Waffles's room always has human snacks, and Nico's den starts stocked.
        const required = firstHome ? [firstHome] : floor.id === 2 ? [...candidates.filter(spot => spot.room === 'corgiPlayroom').slice(0, 3), ...candidates.filter(spot => spot.room === 'snackerDen').slice(0, 1)] : [];
        return [...required, ...candidates.filter(spot => !required.includes(spot))].slice(0, count);
      });
      const generated = selected.map(spot => {
        const roomKinds = kindsByRoom[spot.room];
        const kindId = roomKinds[Math.floor(next() * roomKinds.length)];
        const kind = snackKinds.find(item => item.id === kindId);
        return {
          id: `munchie-${spot.id}`, kind: kind.id, name: kind.name, icon: kind.icon,
          energy: kind.energy, room: spot.room, level: spot.level, x: spot.x, y: spot.y,
          hidingSpots: [{ x: spot.x, y: spot.y }], clue: roomClues[spot.room], detail: kind.detail
        };
      });
      snacks.splice(0, snacks.length, ...generated);
      return snacks;
    },
    isHome(x, y, level = this.level) {
      return level === home.level && this.getRoom(x, y, level)?.id === home.room && Math.hypot(x - home.x, y - home.y) <= home.radius;
    },
    // Discovery is local to the player's room. The application remembers
    // discoveries; a limited hint may reveal its target from any room.
    canSeeSnack(snack, player, hintTarget = null) {
      if (!snack || !player) return false;
      const level = player.level ?? this.level;
      if (snack.level !== level) return false;
      if (hintTarget === snack.id) return true;
      return this.getRoom(player.x, player.y, level)?.id === snack.room && Math.hypot(snack.x - player.x, snack.y - player.y) <= this.rules.discoveryRadius;
    },
    getRoom(x, y, level = this.level) {
      return floors.find(floor => floor.id === level)?.rooms.find(room => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) || null;
    },
    isWalkable(x, y, radius = 0.22, level = this.level) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0 ||
          x < 1 + radius || x > 29 - radius || y < 1 + radius || y > 21 - radius) return false;
      const floor = floors[level];
      if (!floor || floor.id !== level) return false;
      for (const profile of floor.collisionProfiles) {
        if (x < profile.x - radius || x > profile.x + profile.w + radius ||
            y < profile.y - radius || y > profile.y + profile.h + radius) continue;
        if (clearance(profile, x, y, radius) < -1e-10) return false;
      }
      return true;
    },
    moveCircle(x, y, dx, dy, radius = .22, level = this.level) {
      const finiteOrigin = Number.isFinite(x) && Number.isFinite(y);
      const unchanged = { x: finiteOrigin ? x : this.start.x, y: finiteOrigin ? y : this.start.y, distance: 0 };
      if (!finiteOrigin || !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(radius) || radius < 0 ||
          !this.isWalkable(x, y, radius, level)) return unchanged;
      const requested = Math.hypot(dx, dy);
      if (!Number.isFinite(requested) || requested < 1e-10) return unchanged;
      const profiles = floors[level].collisionProfiles, ux = dx / requested, uy = dy / requested;
      let px = x, py = y, distance = 0, remaining = requested;
      while (remaining > 1e-9) {
        const stride = Math.min(.08, remaining), result = slideStep(profiles, px, py, ux * stride, uy * stride, radius);
        // Numeric contact error must never commit an overlapping actor.
        if (!this.isWalkable(result.x, result.y, radius, level)) break;
        px = result.x; py = result.y; distance += result.distance; remaining -= stride;
        if (result.distance < 1e-9) break;
      }
      return { x: px, y: py, distance: Math.min(requested, distance) };
    },
    nearestSnack(x, y, found = new Set(), maxDistance = Infinity, level = this.level) {
      let nearest = null;
      let best = maxDistance;
      snacks.forEach(snack => {
        if (snack.level !== level) return;
        const collected = typeof found.has === 'function' ? found.has(snack.id) : found.includes(snack.id);
        const distance = Math.hypot(snack.x - x, snack.y - y);
        if (!collected && distance <= best) { nearest = snack; best = distance; }
      });
      return nearest;
    }
  };
  // A deterministic initial layout makes standalone renderer/geometry checks
  // useful; beginning or retrying an actual run shuffles it with fresh randomness.
  world.shuffleSnacks(() => .5);
  window.HSWorld = world;
})();
