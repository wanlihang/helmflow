interface JsonBlockProps {
  data: unknown;
}

export function JsonBlock({ data }: JsonBlockProps) {
  return (
    <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
