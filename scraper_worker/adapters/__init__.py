from .arogga import AroggaAdapter
from .daraz import DarazAdapter
from .foodi import FoodiAdapter
from .othoba import OthobaAdapter
from .pandamart import PandamartAdapter
from .shajgoj import ShajgojAdapter
from .shwapno import ShwapnoAdapter

ADAPTERS = {
    "arogga": AroggaAdapter,
    "daraz": DarazAdapter,
    "foodi": FoodiAdapter,
    "othoba": OthobaAdapter,
    "pandamart": PandamartAdapter,
    "shajgoj": ShajgojAdapter,
    "shwapno": ShwapnoAdapter,
}
