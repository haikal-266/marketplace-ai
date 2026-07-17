from dataclasses import dataclass, field
from datetime import datetime
import csv
import json
from pathlib import Path


@dataclass
class Listing:
    title: str = ""
    price: str = ""
    location: str = ""
    url: str = ""
    image_url: str = ""
    seller: str = ""
    seller_url: str = ""
    posted: str = ""
    condition: str = ""
    delivery: str = ""
    description: str = ""
    is_detail_pending: bool = False
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "price": self.price,
            "location": self.location,
            "url": self.url,
            "image_url": self.image_url,
            "seller": self.seller,
            "seller_url": self.seller_url,
            "posted": self.posted,
            "condition": self.condition,
            "delivery": self.delivery,
            "description": self.description,
            "is_detail_pending": self.is_detail_pending,
            "scraped_at": self.scraped_at,
        }


class DataStore:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir
        self.listings: list[Listing] = []

    def add(self, listing: Listing):
        if listing.title or listing.price:
            self.listings.append(listing)

    def save_csv(self, filename: str = "listings.csv"):
        path = self.output_dir / filename
        if not self.listings:
            print("No listings to save")
            return path
        fieldnames = list(self.listings[0].to_dict().keys())
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for listing in self.listings:
                writer.writerow(listing.to_dict())
        print(f"Saved {len(self.listings)} listings to {path}")
        return path

    def save_json(self, filename: str = "listings.json"):
        path = self.output_dir / filename
        data = [l.to_dict() for l in self.listings]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved {len(self.listings)} listings to {path}")
        return path
