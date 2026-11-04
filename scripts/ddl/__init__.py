"""Shared stdlib-only helpers for the Python collectors in scripts/.

Scripts have hyphenated file names, so they import this package with
``sys.path.insert(0, str(Path(__file__).resolve().parent))`` followed by
``from ddl import web, store``.
"""
