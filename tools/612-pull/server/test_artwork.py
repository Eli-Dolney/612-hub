"""Offline artwork tests, using synthetic local images and no remote media."""
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from yt_dlp import YoutubeDL
from .artwork import ArtworkPP, _fallback, enable_artwork_options, attach_artwork

class ArtworkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ydl = YoutubeDL({'quiet': True})
        self.pp = ArtworkPP(self.ydl, self.root)

    def test_track_playlist_and_retry(self):
        media = self.root / 'Song [abc].wav'; media.write_bytes(b'synthetic')
        original = self.root / 'source.png'; _fallback(original)
        track = {'id':'abc', 'extractor_key':'Test', 'title':'Song',
                 'filepath':str(media), 'thumbnails':[{'filepath':str(original)}]}
        self.pp.run(track)
        data = json.loads(media.with_suffix('.artwork.json').read_text())
        self.assertEqual(data['artwork_status'], 'available')
        self.assertEqual(data['media'], media.name)
        self.assertTrue((self.root/data['original_artwork']).exists())
        self.assertEqual(struct.unpack('!II',(self.root/data['cover']).read_bytes()[16:24]),(128,128))
        self.pp.run({'_type':'playlist','id':'pl','extractor_key':'Test','title':'Playlist',
                     'entries':[track,{'id':'failed'}]})
        manifest = json.loads(next(self.root.glob('playlist-*.artwork.json')).read_text())
        self.assertEqual(manifest['cover_source'],'track')
        self.assertEqual(len(manifest['tracks']),1)
        self.assertTrue((self.root/manifest['tracks'][0]['metadata']).is_file())
        self.pp.run(track)
        self.assertEqual(json.loads(media.with_suffix('.artwork.json').read_text())['id'],data['id'])

    def test_no_art_or_ffmpeg(self):
        media=self.root/'none.wav'; media.write_bytes(b'bad')
        with patch('shutil.which',return_value=None):
            self.pp.run({'id':'none','filepath':str(media),'thumbnails':[{'filepath':'missing.jpg'}]})
        data=json.loads(media.with_suffix('.artwork.json').read_text())
        self.assertEqual(data['artwork_status'],'placeholder')
        self.assertEqual(struct.unpack('!II',(self.root/data['cover']).read_bytes()[16:24]),(128,128))
        self.assertEqual(media.read_bytes(),b'bad')

    def test_own_playlist_image(self):
        image=self.root/'playlist-source.png'; _fallback(image)
        self.pp.run({'_type':'playlist','id':'empty','title':'Empty','entries':[],
                     'thumbnails':[{'filepath':str(image)}]})
        data=json.loads(next(self.root.glob('playlist-*.artwork.json')).read_text())
        self.assertEqual(data['cover_source'],'playlist')
        self.assertEqual(data['tracks'],[])

    def test_hook_registration_and_options(self):
        opts={'postprocessors':[{'key':'EmbedThumbnail'}]}; enable_artwork_options(opts)
        self.assertTrue(opts['writethumbnail'])
        self.assertTrue(opts['postprocessors'][0]['already_have_thumbnail'])
        attach_artwork(self.ydl,self.root)
        self.assertIsInstance(self.ydl._pps['after_move'][-1],ArtworkPP)
        self.assertIs(self.ydl._pps['after_move'][-1],self.ydl._pps['playlist'][-1])

if __name__=='__main__':unittest.main()
