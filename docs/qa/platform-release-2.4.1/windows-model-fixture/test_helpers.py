import unittest
from helpers import clamp, unique, chunks

class HelpersTest(unittest.TestCase):
    def test_clamp_bounds(self):
        self.assertEqual([clamp(x, -2, 4) for x in [-9, -2, 0, 4, 9]], [-2, -2, 0, 4, 4])
        self.assertEqual(clamp(3.5, 0.5, 2.5), 2.5)
        self.assertEqual(clamp(99, 2, 2), 2)
    def test_clamp_invalid(self):
        with self.assertRaises(ValueError): clamp(1, 4, 2)
    def test_unique(self):
        values = [3, 1, 3, 2, 1]
        self.assertEqual(unique(values), [3, 1, 2])
        self.assertEqual(values, [3, 1, 3, 2, 1])
        self.assertEqual(unique([]), [])
        self.assertEqual(unique([[1], [2], [1]]), [[1], [2]])
    def test_chunks(self):
        values = [1, 2, 3, 4, 5]
        self.assertEqual(chunks(values, 2), [[1, 2], [3, 4], [5]])
        self.assertEqual(chunks(values, 9), [values])
        self.assertEqual(chunks([], 3), [])
        self.assertEqual(values, [1, 2, 3, 4, 5])
    def test_chunks_invalid(self):
        for size in [0, -1]:
            with self.assertRaises(ValueError): chunks([1, 2], size)

if __name__ == '__main__': unittest.main()
