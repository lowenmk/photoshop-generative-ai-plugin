import re


LORA_TOKEN_REGEX = re.compile(r"<lora:\s*([^:>]+?)\s*:\s*([-+]?\d+(?:\.\d+)?)\s*>", re.IGNORECASE)


def parse_lora_tokens(prompt):
    if not prompt:
        return []
    return [
        {"name": match.group(1).strip(), "weight": float(match.group(2))}
        for match in LORA_TOKEN_REGEX.finditer(prompt)
    ]
