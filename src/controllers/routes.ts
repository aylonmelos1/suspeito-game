import { Router } from "express";
import { TabelaService } from "../services/tabela";
import { StorageService } from "../services/storage";

const route = Router()


route.get('/tabela', (req, res) => {
    res.json(TabelaService.getTabela())
})

route.post('/room', async (req, res) => {
    try {
        const code = await StorageService.generateUniqueRoomCode();
        res.json({ code });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao gerar código de sala' });
    }
});

export default route