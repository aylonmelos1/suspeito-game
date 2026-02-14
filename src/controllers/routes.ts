import { Router } from "express";
import { TabelaService } from "../services/tabela";

const route = Router()


route.get('/tabela', (req, res) => {
    res.json(TabelaService.getTabela())
})



export default route