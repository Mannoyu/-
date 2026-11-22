// Right-hand lyric controls. Dimensions are pixels on the 1920×1080 stage.
export const LYRIC_STYLE={
  left:'51%',top:'21%',width:'42%',
  inset:40,offset:100,lead:31,hero:76,latin:96,translation:22,
  rowGap:8,translationGap:26,entrance:.46,travel:18,
};

export const LYRIC_EFFECTS={
  enabled:true,sweepPeriod:2.8,sweepWidth:.18,glow:1,
  contour:{reveal:.45,period:2.4,verseAlpha:.06,chorusAlpha:.12,spread:8},
};

// Optional exact-text overrides. Parts preserve the complete original wording.
export const LYRIC_LAYOUTS={
  '君と僕の間に　横たわる宇宙':{
    semantic:'distance',
    parts:[{text:'君と僕の間に',role:'distance'},{text:'横たわる',role:'lead'},{text:'宇宙',role:'cosmos'}],
  },
};

export const OPENING_STYLE={titleLines:['Mr.','Broken Heart'],holdUntil:5.25,exitDuration:.8};

export const TEMPLATE_STYLE={
  left:'52%',top:'30%',width:'40%',
  original:56,latin:64,credit:34,translation:34,
  originalHeight:166,translationTop:206,translationHeight:116,
  entrance:.42,exit:.18,
};

export const TEMPLATE_LYRIC_LAYOUTS={};
