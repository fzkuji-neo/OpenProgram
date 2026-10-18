"""Single-model document programs and their deterministic helpers."""

from .extract_pdf_figures import ENTRY_OPTIONS as _FIGURE_OPTIONS
from .extract_pdf_figures import extract_pdf_figures
from .extract_pdf_tables import ENTRY_OPTIONS as _TABLE_OPTIONS
from .extract_pdf_tables import extract_pdf_tables

PROGRAM_ENTRIES = [extract_pdf_figures, extract_pdf_tables]
ENTRY_OPTIONS = {**_FIGURE_OPTIONS, **_TABLE_OPTIONS}
