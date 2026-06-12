import math
from datetime import datetime, timezone
from sgp4.api import Satrec

def generate_conjunction_tle_pair(epoch_dt: datetime):
    # Year: 2 digit. e.g., 2026 -> 26
    year_str = str(epoch_dt.year)[-2:]
    
    # Day of year and fraction.
    # Day of year:
    jan1 = datetime(epoch_dt.year, 1, 1, tzinfo=timezone.utc)
    delta = epoch_dt - jan1
    # Day of year is delta.days + 1. But with fractional part, it's delta.total_seconds() / 86400 + 1
    day_frac = delta.total_seconds() / 86400.0 + 1.0
    
    # Format: YY + day_frac (000.00000000 format, total 14 characters)
    epoch_str = f"{year_str}{day_frac:012.8f}"
    
    # Let's take a real Starlink TLE (or one matching the rules: ~550km, 15.30 rev/day, 53 deg incl)
    # E.g., mean motion 15.30 is about 550km altitude.
    
    # TLE format (Standard):
    # Line 1:
    # 1 NNNNNU NNNNNAAA YYYYDDD.DDDDDDDD +.NNNNNNNN +NNNNN-N +NNNNN-N N NNNNN
    # Line 2:
    # 2 NNNNN NNN.NNNN NNN.NNNN NNNNNNN NNN.NNNN NNN.NNNN NN.NNNNNNNNNNNNNN
    
    # We want NORAD IDs 99001 and 99002.
    
    # Base elements:
    inc = "53.0500"
    raan_a = 0.0
    ecc = "0001000"
    argp = "0.0000"
    ma_a = 0.0
    mm = "15.30000000"
    
    def format_angle(deg):
        return f"{deg:8.4f}".rjust(8, ' ')
        
    line1_a = f"1 99001U 24001A   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_a = f"2 99001  {inc} {format_angle(raan_a)} {ecc} {format_angle(argp)} {format_angle(ma_a)} {mm}    00"
    
    raan_b = raan_a + 0.01
    ma_b = ma_a - 0.005
    # Fix formatting if negative, but 0.0 - 0.005 = -0.005 -> wait, mean anomaly should be 0-360.
    if ma_b < 0: ma_b += 360.0
    
    line1_b = f"1 99002U 24001B   {epoch_str}  .00000000  00000-0  00000-0 0  9999"
    line2_b = f"2 99002  {inc} {format_angle(raan_b)} {ecc} {format_angle(argp)} {format_angle(ma_b)} {mm}    00"
    
    return ("DEMO-SAT-A", line1_a, line2_a), ("DEMO-SAT-B", line1_b, line2_b)

dt = datetime.now(tz=timezone.utc)
(na, l1a, l2a), (nb, l1b, l2b) = generate_conjunction_tle_pair(dt)
print(l1a)
print(l2a)
print(l1b)
print(l2b)

# Now validate find_tca
import sys
sys.path.append("/Users/rishetmehra/Desktop/Faraway")
from backend.orbital.conjunction import ConjunctionInput, find_tca
from datetime import timedelta

sat1 = Satrec.twoline2rv(l1a, l2a)
sat2 = Satrec.twoline2rv(l1b, l2b)

c_input = ConjunctionInput(
    sat1_satrec=sat1,
    sat2_satrec=sat2,
    t_start=dt,
    t_end=dt + timedelta(minutes=5)
)

out = find_tca(c_input)
print("TCA:", out.tca)
print("Miss distance:", out.miss_distance_km)
