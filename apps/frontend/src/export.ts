import type { ConstituencyResult } from "@kerala-election/shared";

export function downloadJson(results: ConstituencyResult[]) {
  download("kerala-election-results.json", "application/json", JSON.stringify(results, null, 2));
}

export function downloadCsv(results: ConstituencyResult[]) {
  const rows = [
    ["Constituency", "No", "Candidate", "Party", "EVM Votes", "Postal Votes", "Total Votes", "Vote %", "Margin", "Last Updated"],
    ...results.flatMap((result) =>
      result.candidates.map((candidate) => [
        result.constituencyName,
        result.constituencyNumber,
        candidate.candidateName,
        candidate.party,
        String(candidate.evmVotes),
        String(candidate.postalVotes),
        String(candidate.totalVotes),
        String(candidate.votePercent),
        String(result.margin),
        result.lastUpdated
      ])
    )
  ];
  download("kerala-election-results.csv", "text/csv", rows.map(toCsvLine).join("\n"));
}

function toCsvLine(values: string[]) {
  return values.map((value) => `"${value.replace(/"/g, '""')}"`).join(",");
}

function download(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
