const cp = require('child_process');
try {
  const result = cp.spawnSync('node_modules/ffmpeg-static/ffmpeg.exe', [
    '-i', 'c:/Users/tails/OneDrive/Desktop/agente-manga/roteiro_im_the_max_level_newbie_postavel_2026-06-13T19-12-51_audio_2026-06-13T19-43-29.wav',
    '-loop', '1', '-t', '46.64', '-i', 'C:\\Users\\tails\\OneDrive\\Desktop\\agente-manga\\downloads\\im_the_max_level_newbie\\bloco_01.png',
    '-loop', '1', '-t', '46.64', '-i', 'C:\\Users\\tails\\OneDrive\\Desktop\\agente-manga\\downloads\\im_the_max_level_newbie\\bloco_02.png',
    '-stream_loop', '-1', '-i', 'assets\\bgm\\Better Days - LAKEY INSPIRED.mp3',
    '-y', '-filter_complex', "[1:v]scale=1920:-1,zoompan=z='min(zoom+0.001,1.1)':d=1400:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,hflip,eq=brightness=-0.04:contrast=1.02,colorchannelmixer=rr=1:gg=1:bb=1:ra=1.2:gb=0.8:enable='gte(t,max(0, 46.64 - 0.3))'[v_bloco_0];[2:v]scale=1920:-1,crop=1920:1080:0:'max(0,min((ih-1080),(t/46.64)*(ih-1080)))',hflip,eq=brightness=-0.04:contrast=1.02,colorchannelmixer=rr=1:gg=1:bb=1:ra=1.2:gb=0.8:enable='gte(t,max(0, 46.64 - 0.3))'[v_bloco_1];[v_bloco_0][v_bloco_1]concat=n=2:v=1:a=0[v_base_concat];[v_base_concat]ass='roteiro_im_the_max_level_newbie_postavel_2026-06-13T19-12-51_audio_2026-06-13T19-43-29.ass'[v_out];[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=1.0[a_voz_fmt];[a_voz_fmt]amix=inputs=1:duration=first:dropout_transition=2[a_fg_mixed];[3:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.3[a_bgm_fmt];[a_fg_mixed]asplit[a_fg_out][a_fg_sc];[a_bgm_fmt][a_fg_sc]sidechaincompress=threshold=0.08:ratio=5:attack=5:release=300[a_bgm_ducked];[a_fg_out][a_bgm_ducked]amix=inputs=2:duration=first:dropout_transition=2[a_out]",
    '-map', '[v_out]', '-map', '[a_out]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', 'test_full_render2.mp4'
  ]);
  console.log('stdout:', result.stdout.toString());
  console.error('stderr:', result.stderr.toString());
} catch(e) {
  console.error(e.message);
}
