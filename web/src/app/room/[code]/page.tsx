import { RoomClient } from "@/components/RoomClient";

type Props = {
  params: Promise<{ code: string }>;
};

export default async function RoomPage({ params }: Props) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
