import io
import json
import runpy
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np


analyzer = runpy.run_path(str(Path(__file__).with_name('workbench-audio.py')))


class AudioAnalysisTest(unittest.TestCase):
    def test_chunk_edges_match_a_single_pass_with_bounded_reads(self):
        sample_rate = 48000
        hop = sample_rate // 30
        batch_size = 5
        stereo = np.zeros((hop * 517 + 17, 2), dtype='<i2')
        stereo[hop * 5 - 20:hop * 5 + 900] = [8000, -2300]
        stereo[-901:] = [12500, 17000]
        wire = io.BytesIO()
        with wave.open(wire, 'wb') as writer:
            writer.setparams((2, 2, sample_rate, 0, 'NONE', 'not compressed'))
            writer.writeframes(stereo.tobytes())
        wire.seek(0)
        with wave.open(wire, 'rb') as source:
            step, expected = analyzer['analyze'](source, 1000)
            with patch.object(source, 'readframes', wraps=source.readframes) as read:
                step, values = analyzer['analyze'](source, batch_size)
            self.assertLessEqual(max(call.args[0] for call in read.call_args_list), (batch_size - 1) * hop + 2048)
        np.testing.assert_array_equal(values, expected)
        self.assertEqual(values.shape, (518, 16))
        self.assertGreater(values[5, 2], 0)
        self.assertGreater(values[-1, 0], 0)
        output = io.StringIO()
        analyzer['write_features'](output, step, values)
        data = json.loads(output.getvalue())
        self.assertEqual(data['step'], 1 / 30)
        self.assertEqual(data['bands'], expected[:, 3:].tolist())


if __name__ == '__main__':
    unittest.main()
