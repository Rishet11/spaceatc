from datetime import datetime, timezone, timedelta
from backend.api.routes import generate_conjunction_tle_pair
from sgp4.api import Satrec
from backend.orbital.conjunction import ConjunctionInput, find_tca

dt = datetime.now(tz=timezone.utc)
(na, l1a, l2a), (nb, l1b, l2b) = generate_conjunction_tle_pair(dt)
sat1 = Satrec.twoline2rv(l1a, l2a)
sat2 = Satrec.twoline2rv(l1b, l2b)

# First test with 5 mins
c_input = ConjunctionInput(sat1, sat2, dt, dt + timedelta(minutes=5))
out = find_tca(c_input)
print("5 MINS:", out.tca, "Miss:", out.miss_distance_km, "Pc:", out.pc)

# Test with 3 days
c_input3 = ConjunctionInput(sat1, sat2, dt, dt + timedelta(days=3))
out3 = find_tca(c_input3)
print("3 DAYS:", out3.tca, "Miss:", out3.miss_distance_km, "Pc:", out3.pc)

