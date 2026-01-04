import { Application, extend } from "@pixi/react";
import { Container, Graphics, Text } from "pixi.js";
import type { PrettyMessage } from "./App";

// Register PixiJS components
extend({ Container, Graphics, Text });

interface PixiMessagesProps {
  messages: PrettyMessage[];
}

function MessageRenderer({ messages }: PixiMessagesProps) {
  return (
    <pixiContainer>
      {messages.map((message, index) => {
        const yPosition = index * 80 + 20;
        const isSystem = message.kind === "system";

        const sentDate = message.sent.toDate();
        const now = new Date();
        const isOlderThanDay =
          now.getFullYear() !== sentDate.getFullYear() ||
          now.getMonth() !== sentDate.getMonth() ||
          now.getDate() !== sentDate.getDate();

        const timeString = sentDate.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const dateString = isOlderThanDay
          ? `${sentDate.toLocaleDateString([], {
              year: "numeric",
              month: "short",
              day: "numeric",
            })} `
          : "";

        return (
          <pixiContainer
            key={`${message.senderName}-${message.text}-${message.sent.toString()}`}
            y={yPosition}
          >
            {/* Sender name and timestamp */}
            <pixiText
              text={`${isSystem ? "System" : message.senderName}  ${dateString}${timeString}`}
              x={10}
              y={0}
              style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 14,
                fontWeight: "bold",
                fill: isSystem ? 0xff6b6b : 0x4dabf7,
              }}
            />

            {/* Message text */}
            <pixiText
              text={message.text}
              x={10}
              y={22}
              style={{
                fontFamily: "Arial, sans-serif",
                fontSize: 16,
                fill: 0xffffff,
                wordWrap: true,
                wordWrapWidth: 580,
              }}
            />

            {/* Separator line */}
            <pixiGraphics
              y={65}
              draw={(g) => {
                g.clear();
                g.rect(10, 0, 580, 1);
                g.fill({ color: 0x333333 });
              }}
            />
          </pixiContainer>
        );
      })}
    </pixiContainer>
  );
}

export default function PixiMessages({ messages }: PixiMessagesProps) {
  return (
    <div style={{ width: "600px", height: "400px", margin: "20px auto" }}>
      <Application
        width={600}
        height={400}
        backgroundColor={0x1a1a1a}
        antialias={true}
      >
        <MessageRenderer messages={messages} />
      </Application>
    </div>
  );
}
