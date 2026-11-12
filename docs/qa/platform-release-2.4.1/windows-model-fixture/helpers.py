def clamp(x, lo, hi):
    if lo > hi:
        raise ValueError("lo must be less than or equal to hi")
    return max(lo, min(x, hi))

def unique(items):
    seen = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen

def chunks(items, size):
    if size <= 0:
        raise ValueError("size must be greater than 0")
    if not items:
        return []
    
    return [items[i:i + size] for i in range(0, len(items), size)]