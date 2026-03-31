from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ACTORS_DB_DIR = ROOT / "Actors Database"
ACTORS_FACES_DIR = ROOT / "Actors Faces"
OUTPUT_CSV = ROOT / "Actors_Database.csv"


MANUAL_ALIASES = {
    "Mahesh Babu": ["Ghattamaneni Mahesh Babu", "Superstar", "Prince Mahesh Babu", "SSMB"],
    "Naga Chaitanya": ["Akkineni Naga Chaitanya"],
    "N T Rama Rao Jr.": ["Nandamuri Taraka Rama Rao", "NTR Jr", "Jr NTR", "Young Tiger", "Man of Masses"],
    "Pawan Kalyan": ["Konidela Pawan Kalyan", "Konidela Kalyan Babu", "Power Star", "PSPK"],
    "Prabhas": ["Uppalapati Venkata Suryanarayana Prabhas Raju", "Rebel Star", "Darling"],
    "Allu Arjun": ["Bunny", "Icon Star", "Mallu Arjun"],
    "Ram Charan": ["Konidela Ram Charan", "Mega Power Star"],
    "Chiranjeevi": ["Konidela Chiranjeevi", "Konidela Sivasankara Varaprasad", "Mega Star", "Megastar"],
    "Venkatesh": ["Daggubati Venkatesh", "Victory Venkatesh", "Venky"],
    "Balakrishna": ["Nandamuri Balakrishna", "Balayya", "NBK"],
    "Nagarjuna Akkineni": ["Akkineni Nagarjuna", "King Nagarjuna", "King"],
    "Nayanthara": ["Diana Mariam Kurian", "Lady Superstar"],
    "Samantha Ruth Prabhu": ["Samantha"],
    "Ravi Teja": ["Bhupathiraju Ravi Shankar Raju", "Mass Maharaja"],
    "Vijay Deverakonda": ["The Vijay Deverakonda", "Rowdy"],
    "Siddu Jonnalagadda": ["Siddhu Jonnalagadda"],
    "Naga Babu": ["Nagendra Babu", "Konidela Nagendra Babu"],
    "Adivi Sesh": ["Sunny Chandra"],
    "ANR Akkineni Nageswara Rao": ["Akkineni Nageswara Rao", "ANR"],
    "Ajay Devgn": ["Ajay Devgan"],
    "Tamanna Bhatia": ["Tamannaah", "Tamannaah Bhatia"],
    "Shruti Hassan": ["Shruti Haasan"],
    "Kamal Hasan": ["Kamal Haasan"],
    "Dulquer Salman": ["Dulquer Salmaan"],
    "Fahad Fasil": ["Fahadh Faasil"],
    "Satya Raj": ["Sathyaraj"],
    "Shobita Dhulipala": ["Sobhita Dhulipala"],
    "Jaya Praksah Reddy": ["Jaya Prakash Reddy"],
    "Karrhikeya Dev": ["Karthikeya Dev"],
    "Prudhvi Raj": ["Prithvi Raj"],
    "Prudhviraj Sukumaran": ["Prithviraj Sukumaran"],
    "Rp Patnaik": ["RP Patnaik", "R. P. Patnaik"],
    "Gv Prakash": ["GV Prakash", "G. V. Prakash"],
    "Sp Balasubramanyam": ["SP Balasubrahmanyam", "S. P. Balasubrahmanyam", "SPB"],
    "SJ Suriya": ["S. J. Suryah", "SJ Suryah", "S J Suryah"],
    "S. J. Suriya": ["S. J. Suryah", "SJ Suriya", "SJ Suryah", "S J Suriya"],
    "P. Sai Kumar": ["P Sai Kumar", "P SaiKumar"],
    "Sai Kumar": ["Saikumar"],
    "Naresh": ["Naresh Vijay Krishna", "Naresh Senior"],
    "Harshavardhan": ["Harsha Vardhan"],
    "Ketika Sharma": ["Kethika Sharma"],
    "Priyanka Mohan": ["Priyanka Arul Mohan"],
    "C. V. L. Narasimha Rao": ["CVL Narasimha Rao"],
    "CVL Narasimha Rao": ["C. V. L. Narasimha Rao"],
    "Nani": ["Natural Star Nani", "Naveen Babu Ghanta"],
    "Akhil Akkineni": ["Akhil"],
    "Sai Dharam Tej": ["Sai Durgha Tej", "SDT", "Supreme Hero"],
    "Varun Tej": ["Konidela Varun Tej"],
    "Naga Shourya": ["Naga Shaurya"],
    "Kalyan Ram": ["Nandamuri Kalyan Ram"],
    "Bellamkonda Sreenivas": ["Bellamkonda Sai Sreenivas", "BSS"],
    "Raj Tarun": ["Aandagadu"],
    "Nikhil Siddhartha": ["Nikhil"],
    "Sudheer Babu": ["Posani Sudheer Babu"],
    "Sree Vishnu": ["Rudraraju Vishnuvardhan"],
    "Vishwak Sen": ["Vishwaksen", "Dinesh Naidu"],
    "Aadi Saikumar": ["Aadi"],
    "Uday Kiran": ["Vajapeyajula Uday Kiran"],
    "Akhil Akkineni": ["Akhil"],
}


DESCRIPTOR_WORDS = {
    "actor",
    "comedian",
    "character",
    "charcter",
    "artist",
    "senior",
    "court",
    "fame",
}


def read_actor_names() -> list[str]:
    names = {path.stem.split("__")[0] for path in ACTORS_DB_DIR.iterdir() if path.is_file()}
    return sorted(names, key=lambda value: value.lower())


def normalized_key(name: str) -> str:
    lowered = name.lower()
    lowered = lowered.replace("&", "and")
    lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
    tokens = [token for token in lowered.split() if token not in DESCRIPTOR_WORDS]
    return "".join(tokens)


def collect_folder_variants() -> dict[str, set[str]]:
    grouped: dict[str, set[str]] = defaultdict(set)
    for folder in (ACTORS_DB_DIR, ACTORS_FACES_DIR):
        for path in folder.iterdir():
            if not path.is_file():
                continue
            name = path.stem.split("__")[0].strip()
            grouped[normalized_key(name)].add(name)
    return grouped


def prettify_token(token: str) -> str:
    if token.isupper():
        return token
    return token.capitalize()


def generic_aliases(name: str) -> list[str]:
    aliases: list[str] = [name]
    no_dots = re.sub(r"\.", "", name).replace("  ", " ").strip()
    spaced = re.sub(r"\s+", " ", re.sub(r"[._-]+", " ", no_dots)).strip()
    if no_dots and no_dots != name:
        aliases.append(no_dots)
    if spaced and spaced not in aliases:
        aliases.append(spaced)
    return aliases


def slugify_base(name: str) -> str:
    raw_tokens = [re.sub(r"[^A-Za-z0-9]", "", token).lower() for token in name.split()]
    raw_tokens = [token for token in raw_tokens if token]
    if not raw_tokens:
        return "ACT"

    normalized_tokens = []
    for token in raw_tokens:
        if token == "jr":
            normalized_tokens.append("junior")
        elif token == "sr":
            normalized_tokens.append("senior")
        else:
            normalized_tokens.append(token)

    def compress_token(token: str) -> str:
        token = re.sub(r"(.)\1+", r"\1", token)
        if len(token) <= 3:
            return token

        first = token[0]
        rest = "".join(ch for ch in token[1:] if ch not in "aeiou")
        compressed = first + rest
        compressed = re.sub(r"(.)\1+", r"\1", compressed)

        if len(compressed) < 3:
            compressed = token[:3]
        return compressed

    if len(normalized_tokens) == 1:
        token = compress_token(normalized_tokens[0])
        return token[:8].upper() if len(token) >= 3 else (token + "XXX")[:3].upper()

    parts = []
    prefix = ""
    for token in normalized_tokens:
        if len(token) < 3:
            prefix += token
            continue

        combined = compress_token(prefix + token)
        prefix = ""
        piece = combined[:4] if len(combined) > 4 else combined
        if len(piece) < 3:
            piece = combined[:3] if len(combined) >= 3 else (combined + "xxx")[:3]
        parts.append(piece.upper())

    if prefix:
        tail = compress_token(prefix)
        tail = tail[:4] if len(tail) > 4 else tail
        if len(tail) < 3:
            tail = (tail + "xxx")[:3]
        parts.append(tail.upper())

    return "-".join(parts[:4])


def build_unique_slugs(names: list[str]) -> dict[str, str]:
    assigned: dict[str, str] = {}
    used: set[str] = set()
    for name in names:
        base = slugify_base(name)
        slug = base
        counter = 2
        while slug in used:
            suffix = str(counter)
            slug = f"{base}-{suffix}"
            counter += 1
        assigned[name] = slug
        used.add(slug)
    return assigned


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = re.sub(r"\s+", " ", value).strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def build_rows() -> list[dict[str, str]]:
    actors = read_actor_names()
    slugs = build_unique_slugs(actors)
    folder_variants = collect_folder_variants()
    rows = []

    for actor in actors:
        aliases = []
        aliases.extend(generic_aliases(actor))
        aliases.extend(sorted(folder_variants.get(normalized_key(actor), set())))
        aliases.extend(MANUAL_ALIASES.get(actor, []))
        alias_values = [value for value in dedupe_preserve_order(aliases) if value.strip().lower() != actor.strip().lower()]

        rows.append(
            {
                "Alug": slugs[actor],
                "Actor": actor,
                "Aliases": "; ".join(alias_values),
            }
        )

    return rows


def main() -> None:
    rows = build_rows()
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Alug", "Actor", "Aliases"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
