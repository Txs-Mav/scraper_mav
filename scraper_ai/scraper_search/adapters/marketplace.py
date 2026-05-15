"""
Compat module — les marketplaces vivent désormais dans des fichiers dédiés.

Ce module est conservé pour la compatibilité ascendante (anciens imports
`from .marketplace import AutoTraderAdapter, KijijiAdapter, CycleTraderAdapter`).
"""
from __future__ import annotations

# Re-exports des nouveaux modules dédiés
from .autotrader import AutoTraderAdapter  # noqa: F401
from .cycletrader import CycleTraderAdapter  # noqa: F401
from .kijiji import KijijiAdapter  # noqa: F401
