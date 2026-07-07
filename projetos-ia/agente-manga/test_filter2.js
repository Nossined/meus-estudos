const cp = require('child_process');
try {
  cp.execFileSync('node_modules/ffmpeg-static/ffmpeg.exe', [
    '-f', 'lavfi', 
    '-i', 'testsrc=s=1920x1080', 
    '-vf', "scale=1920:-1,zoompan=z='min(zoom+0.001,1.1)':d=1400:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,hflip,eq=brightness=-0.04:contrast=1.02,colorchannelmixer=rr=1:gg=1:bb=1:ra=1.2:gb=0.8:enable='gte(t,max(0, 46.64 - 0.3))'", 
    '-t', '1', 
    '-y', 'test_filter.mp4'
  ], {stdio: 'inherit'});
} catch(e) {
  console.error(e.message);
}
