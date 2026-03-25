// Gemini JSON mode schema for markup image generation
export const markupImageSchema = {
    type: "OBJECT",
    properties: {
        version: { type: "STRING", enum: ["markup_v1"] },
        canvas: {
            type: "OBJECT",
            properties: {
                width: { type: "INTEGER" },
                height: { type: "INTEGER" },
                backgroundColor: { type: "STRING" },
            },
            required: ["width", "height", "backgroundColor"],
        },
        layers: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "STRING" },
                    type: { type: "STRING", enum: ["box", "arrow", "callout", "label", "highlight", "number_marker", "text_block", "divider"] },
                    position: {
                        type: "OBJECT",
                        properties: {
                            x: { type: "NUMBER" },
                            y: { type: "NUMBER" },
                        },
                        required: ["x", "y"],
                    },
                    size: {
                        type: "OBJECT",
                        properties: {
                            width: { type: "NUMBER" },
                            height: { type: "NUMBER" },
                        },
                        required: ["width", "height"],
                    },
                    style: {
                        type: "OBJECT",
                        properties: {
                            color: { type: "STRING" },
                            borderColor: { type: "STRING" },
                            borderWidth: { type: "NUMBER" },
                            borderRadius: { type: "NUMBER" },
                            opacity: { type: "NUMBER" },
                            fontSize: { type: "NUMBER" },
                            fontWeight: { type: "STRING", enum: ["normal", "bold"] },
                        },
                        required: ["color"],
                    },
                    content: { type: "STRING" },
                    arrow: {
                        type: "OBJECT",
                        properties: {
                            from: {
                                type: "OBJECT",
                                properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" } },
                                required: ["x", "y"],
                            },
                            to: {
                                type: "OBJECT",
                                properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" } },
                                required: ["x", "y"],
                            },
                            headStyle: { type: "STRING", enum: ["filled", "open", "none"] },
                        },
                        required: ["from", "to", "headStyle"],
                    },
                    numberMarker: {
                        type: "OBJECT",
                        properties: {
                            number: { type: "INTEGER" },
                            description: { type: "STRING" },
                        },
                        required: ["number", "description"],
                    },
                },
                required: ["id", "type", "position", "style"],
            },
        },
        exportSettings: {
            type: "OBJECT",
            properties: {
                format: { type: "STRING", enum: ["png", "svg"] },
                scale: { type: "INTEGER" },
                includeCaption: { type: "BOOLEAN" },
            },
            required: ["format", "scale", "includeCaption"],
        },
    },
    required: ["version", "canvas", "layers", "exportSettings"],
};
