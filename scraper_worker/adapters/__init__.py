from .daraz import DarazAdapter
from .foodi import FoodiAdapter
from .othoba import OthobaAdapter
from .pandamart import PandamartAdapter
from .shajgoj import ShajgojAdapter

ADAPTERS = {
    "daraz": DarazAdapter,
    "pandamart": PandamartAdapter,
    "shajgoj": ShajgojAdapter,
    "foodi": FoodiAdapter,
    "othoba": OthobaAdapter,
}
