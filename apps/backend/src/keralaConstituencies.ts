import type { ConstituencyOption } from "@kerala-election/shared";

const names = [
  "Manjeshwar", "Kasaragod", "Udma", "Kanhangad", "Trikaripur", "Payyannur", "Kalliasseri", "Taliparamba", "Irikkur", "Azhikode",
  "Kannur", "Dharmadam", "Thalassery", "Kuthuparamba", "Mattannur", "Peravoor", "Mananthavady", "Sulthan Bathery", "Kalpetta", "Vadakara",
  "Kuttiady", "Nadapuram", "Koyilandy", "Perambra", "Balusseri", "Elathur", "Kozhikode North", "Kozhikode South", "Beypore", "Kunnamangalam",
  "Koduvally", "Thiruvambady", "Kondotty", "Eranad", "Nilambur", "Wandoor", "Manjeri", "Perinthalmanna", "Mankada", "Malappuram",
  "Vengara", "Vallikkunnu", "Tirurangadi", "Tanur", "Tirur", "Kottakkal", "Thavanur", "Ponnani", "Thrithala", "Pattambi",
  "Shornur", "Ottappalam", "Kongad", "Mannarkkad", "Malampuzha", "Palakkad", "Tarur", "Chittur", "Nenmara", "Alathur",
  "Chelakkara", "Kunnamkulam", "Guruvayur", "Manalur", "Wadakkanchery", "Ollur", "Thrissur", "Nattika", "Kaipamangalam", "Irinjalakuda",
  "Puthukkad", "Chalakudy", "Kodungallur", "Perumbavoor", "Angamaly", "Aluva", "Kalamassery", "Paravur", "Vypin", "Kochi",
  "Thripunithura", "Ernakulam", "Thrikkakara", "Kunnathunad", "Piravom", "Muvattupuzha", "Kothamangalam", "Devikulam", "Udumbanchola", "Thodupuzha",
  "Idukki", "Peerumade", "Pala", "Kaduthuruthy", "Vaikom", "Ettumanoor", "Kottayam", "Puthuppally", "Changanassery", "Kanjirappally",
  "Poonjar", "Aroor", "Cherthala", "Alappuzha", "Ambalappuzha", "Kuttanad", "Haripad", "Kayamkulam", "Mavelikkara", "Chengannur",
  "Thiruvalla", "Ranni", "Aranmula", "Konni", "Adoor", "Karunagappally", "Chavara", "Kunnathur", "Kottarakkara", "Pathanapuram",
  "Punalur", "Chadayamangalam", "Kundara", "Kollam", "Eravipuram", "Chathannoor", "Varkala", "Attingal", "Chirayinkeezhu", "Nedumangad",
  "Vamanapuram", "Kazhakkoottam", "Vattiyoorkavu", "Thiruvananthapuram", "Nemom", "Aruvikkara", "Parassala", "Kattakkada", "Kovalam", "Neyyattinkara"
];

export const fallbackKeralaConstituencies: ConstituencyOption[] = names.map((name, index) => ({
  constituencyId: slugify(name),
  constituencyName: name,
  constituencyNumber: String(index + 1).padStart(3, "0")
}));

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normalizeComparable(input: string): string {
  return slugify(input).replace(/-/g, "");
}
